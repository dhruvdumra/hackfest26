"""Where Market Intelligence reads its displacement radar from.

MARKET_PROVIDER picks the SAP source when USE_MOCK_MARKET=false:

* ``hana`` reads the MARKET_RADAR table on the SAP HANA Cloud instance the app
  already uses for /route and /match (loaded by scripts/load_market_radar_hana.py).
* ``datasphere`` reads a view exposed for consumption in an SAP Datasphere
  space (app/services/datasphere.py, docs/DATASPHERE.md).

Either way the data is the same sample radar as the fixture, and the brief is
labelled ``live`` with the source named only when the read succeeded. Anything
else serves the fixture, labelled ``simulated``.
"""

import asyncio
import logging
from typing import Final

from pydantic import JsonValue

from app.config import Settings
from app.mocks import market_fixtures
from app.services import datasphere, hana_client

logger = logging.getLogger(__name__)

HANA_PROVIDER: Final[str] = "sap_hana_cloud"
HANA_DISCLAIMER: Final[str] = (
    "Sample displacement and demand dataset served from SAP HANA Cloud; "
    "not observed job-board data."
)
SOURCE_NAMES: Final[dict[str, str]] = {
    HANA_PROVIDER: "SAP HANA Cloud",
    datasphere.PROVIDER: "SAP Datasphere",
}


def market_brief(city: str, settings: Settings) -> dict[str, JsonValue]:
    """The radar brief for ``city`` from the configured SAP source, else the fixture."""
    if settings.use_mock_market:
        return market_fixtures.market_brief(city)
    if settings.market_provider == "datasphere":
        return datasphere.market_brief(city, settings)
    if not hana_client.is_available(settings):
        return market_fixtures.market_brief(city)
    try:
        table = datasphere.safe_identifier(settings.hana_market_table)
        rows = hana_client.run_query(settings, f'SELECT * FROM "{table}"')
        return datasphere.brief_from_rows(
            rows, city, provider=HANA_PROVIDER, disclaimer=HANA_DISCLAIMER
        )
    except Exception:
        logger.warning("SAP HANA radar read failed; serving the simulated fixture", exc_info=True)
        return market_fixtures.market_brief(city)


async def market_brief_async(city: str, settings: Settings) -> dict[str, JsonValue]:
    """``market_brief`` off the event loop, bounded by the source's own timeout."""
    timeout = (
        settings.datasphere_timeout_seconds
        if settings.market_provider == "datasphere"
        else settings.hana_query_timeout_seconds
    )
    try:
        return await asyncio.wait_for(asyncio.to_thread(market_brief, city, settings), timeout)
    except TimeoutError:
        logger.warning("the radar read timed out; serving the simulated fixture")
        return market_fixtures.market_brief(city)


def source_name(brief: dict[str, JsonValue]) -> str | None:
    """ "SAP HANA Cloud" or "SAP Datasphere" for a live brief, None for the fixture."""
    if brief.get("source") != "live":
        return None
    return SOURCE_NAMES.get(str(brief.get("provider")))
