"""Market Intelligence's displacement radar, read from SAP Datasphere.

The radar lives in a Datasphere space as a view exposed for consumption. A
Datasphere database user reads it over the same ``hdbcli`` driver and TLS
settings as ``hana_client``: Datasphere runs on SAP HANA Cloud.

The brief is labelled ``live`` only when the read succeeded and every row was
usable. Mock mode, a blank connection detail, an error, a timeout or a bad row
all serve the bundled fixture, labelled ``simulated`` as before. The dataset in
the view is the same sample radar as the fixture (docs/datasphere/market_radar.csv),
so moving it into Datasphere changes where it comes from, not what it says.
"""

import asyncio
import logging
import re
from collections.abc import Mapping, Sequence
from typing import Any, Final, cast

from pydantic import JsonValue

from app.config import Settings, datasphere_is_configured
from app.mocks import market_fixtures
from app.services import hana_client

logger = logging.getLogger(__name__)

PROVIDER: Final[str] = "sap_datasphere"
DISCLAIMER: Final[str] = (
    "Sample displacement and demand dataset served from SAP Datasphere; "
    "not observed job-board data."
)
_IDENTIFIER: Final = re.compile(r"^[A-Za-z0-9_#$.]{1,127}$")
_EXPOSURES: Final = frozenset({"high", "moderate", "low"})
_DEMANDS: Final = frozenset({"growing", "steady", "contracting"})


class DatasphereUnavailableError(RuntimeError):
    pass


def market_brief(city: str, settings: Settings) -> dict[str, JsonValue]:
    """The radar brief for ``city``: from Datasphere when possible, else the fixture."""
    if settings.use_mock_market or not datasphere_is_configured(settings):
        return market_fixtures.market_brief(city)
    try:
        return _live_brief(city, settings)
    except Exception:
        logger.warning(
            "SAP Datasphere radar read failed; serving the simulated fixture", exc_info=True
        )
        return market_fixtures.market_brief(city)


async def market_brief_async(city: str, settings: Settings) -> dict[str, JsonValue]:
    """``market_brief`` off the event loop, bounded by the Datasphere timeout."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(market_brief, city, settings),
            timeout=settings.datasphere_timeout_seconds,
        )
    except TimeoutError:
        logger.warning("SAP Datasphere radar read timed out; serving the simulated fixture")
        return market_fixtures.market_brief(city)


def _live_brief(city: str, settings: Settings) -> dict[str, JsonValue]:
    schema = safe_identifier(settings.datasphere_schema)
    view = safe_identifier(settings.datasphere_view)
    connection = _connect(settings)
    try:
        cursor = connection.cursor()
        try:
            cursor.execute(f'SELECT * FROM "{schema}"."{view}"')
            columns = [str(column[0]) for column in cursor.description or ()]
            rows = [dict(zip(columns, row, strict=False)) for row in cursor.fetchall() or []]
        finally:
            cursor.close()
    finally:
        connection.close()
    return brief_from_rows(rows, city, provider=PROVIDER, disclaimer=DISCLAIMER)


def brief_from_rows(
    rows: Sequence[Mapping[str, Any]], city: str, *, provider: str, disclaimer: str
) -> dict[str, JsonValue]:
    """Turn radar rows from any SAP source into the brief the agent reports.

    Column names are matched case-insensitively. Every row must be usable and at
    least one must exist, otherwise this raises and the caller serves the fixture.
    """
    lowered = [{str(key).casefold(): value for key, value in row.items()} for row in rows]
    entries = sorted((_entry(row) for row in lowered), key=lambda item: item[0])
    if not entries:
        raise DatasphereUnavailableError("the radar source returned no rows")
    wanted = city.strip().casefold()
    in_city = [entry for _, entry in entries if str(entry["city"]).casefold() == wanted]
    # An unknown city shows the whole radar, exactly as the fixture does.
    selected = (in_city or [entry for _, entry in entries])[: market_fixtures.MAX_ENTRIES]
    return {
        "source": "live",
        "provider": provider,
        "city": city.strip() or market_fixtures.DEFAULT_CITY,
        "disclaimer": disclaimer,
        "entry_count": len(selected),
        "openings": sum(cast(int, entry["openings"]) for entry in selected),
        "entry_demand": [entry["demand"] for entry in selected],
        "entries": cast(list[JsonValue], selected),
    }


def _entry(row: Mapping[str, Any]) -> tuple[int, dict[str, JsonValue]]:
    exposure = str(row.get("exposure", "")).strip().casefold()
    demand = str(row.get("demand", "")).strip().casefold()
    if exposure not in _EXPOSURES or demand not in _DEMANDS:
        raise DatasphereUnavailableError(f"unusable radar row: {dict(row)!r}")
    entry: dict[str, JsonValue] = {
        "role": str(row["role"]).strip(),
        "city": str(row["city"]).strip(),
        "exposure": exposure,
        "demand": demand,
        "openings": int(row["openings"]),
        "median_pay": int(row["median_pay"]),
        "signal": str(row.get("signal", "")).strip(),
    }
    return int(row.get("rank", 0)), entry


def safe_identifier(value: str) -> str:
    name = value.strip()
    if not _IDENTIFIER.match(name):
        raise DatasphereUnavailableError(f"unsafe Datasphere identifier {name!r}")
    return name


def _connect(settings: Settings) -> Any:
    module = hana_client._load_optional_module(hana_client.HANA_DRIVER_MODULE)
    connect = getattr(module, "connect", None) if module is not None else None
    if connect is None:
        raise DatasphereUnavailableError("hdbcli is not installed")
    return connect(
        address=settings.datasphere_host,
        port=settings.datasphere_port,
        user=settings.datasphere_user,
        password=settings.datasphere_password.get_secret_value(),
        encrypt=hana_client.HANA_CLOUD_ENCRYPT,
        sslValidateCertificate=hana_client.HANA_CLOUD_VALIDATE_CERTIFICATE,
        connectionTimeout=int(settings.datasphere_timeout_seconds),
    )
