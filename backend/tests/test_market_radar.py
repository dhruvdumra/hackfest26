"""Market Intelligence's source switch: SAP HANA Cloud table or SAP Datasphere view.

MARKET_PROVIDER=hana reads the MARKET_RADAR table on the HANA Cloud instance the
app already uses (scripts/load_market_radar_hana.py loads it from the same CSV
the Datasphere guide uploads). No network here: hana_client is faked.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.mocks.market_fixtures import DISPLACEMENT_RADAR, market_brief
from app.services import datasphere, hana_client, market_radar

COLUMNS = ("RANK", "ROLE", "CITY", "EXPOSURE", "DEMAND", "OPENINGS", "MEDIAN_PAY", "SIGNAL")


def table_rows() -> list[dict[str, Any]]:
    return [
        dict(
            zip(
                COLUMNS,
                (
                    rank,
                    entry["role"],
                    entry["city"],
                    entry["exposure"],
                    entry["demand"],
                    entry["openings"],
                    entry["median_pay"],
                    entry["signal"],
                ),
                strict=True,
            )
        )
        for rank, entry in enumerate(DISPLACEMENT_RADAR, start=1)
    ]


def hana_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "use_mock_market": False,
        "market_provider": "hana",
        "use_mock_hana": False,
        "hana_host": "instance.hna3.prod-eu10.hanacloud.ondemand.com",
        "hana_user": "READER",
        "hana_password": "not-a-real-password",
    }
    values.update(overrides)
    return Settings(**values)


def install_hana(
    monkeypatch: pytest.MonkeyPatch, rows: list[dict[str, Any]] | None = None
) -> list[str]:
    queries: list[str] = []

    def run_query(settings: Settings, sql: str, parameters: Any = None) -> list[dict[str, Any]]:
        queries.append(sql)
        return table_rows() if rows is None else rows

    monkeypatch.setattr(hana_client, "is_available", lambda settings: True)
    monkeypatch.setattr(hana_client, "run_query", run_query)
    return queries


def test_the_hana_table_is_live_and_tells_the_same_story(monkeypatch: pytest.MonkeyPatch) -> None:
    queries = install_hana(monkeypatch)

    brief = market_radar.market_brief("Chennai", hana_settings())

    assert brief["source"] == "live"
    assert brief["provider"] == "sap_hana_cloud"
    assert brief["entry_count"] == 4
    assert brief["openings"] == 28
    assert brief["entries"] == market_brief("Chennai")["entries"]
    assert queries == ['SELECT * FROM "MARKET_RADAR"']


def test_the_table_name_is_configurable_and_checked(monkeypatch: pytest.MonkeyPatch) -> None:
    queries = install_hana(monkeypatch)

    custom = market_radar.market_brief("Chennai", hana_settings(hana_market_table="RADAR_V2"))
    unsafe = market_radar.market_brief(
        "Chennai", hana_settings(hana_market_table='X"; DROP TABLE Y')
    )

    assert custom["source"] == "live"
    assert unsafe["source"] == "simulated"
    assert queries == ['SELECT * FROM "RADAR_V2"']


def test_hana_in_mock_mode_is_never_touched(monkeypatch: pytest.MonkeyPatch) -> None:
    queries = install_hana(monkeypatch)
    monkeypatch.setattr(hana_client, "is_available", lambda settings: False)

    brief = market_radar.market_brief("Chennai", hana_settings(use_mock_hana=True))

    assert brief == market_brief("Chennai")
    assert queries == []


def test_a_hana_error_serves_the_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    install_hana(monkeypatch)

    def broken(settings: Settings, sql: str, parameters: Any = None) -> list[dict[str, Any]]:
        raise hana_client.HanaUnavailableError("instance stopped")

    monkeypatch.setattr(hana_client, "run_query", broken)

    brief = market_radar.market_brief("Chennai", hana_settings())

    assert brief == market_brief("Chennai")


def test_an_empty_table_serves_the_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    install_hana(monkeypatch, rows=[])

    assert market_radar.market_brief("Chennai", hana_settings())["source"] == "simulated"


def test_mock_market_wins_over_the_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    queries = install_hana(monkeypatch)

    brief = market_radar.market_brief("Chennai", hana_settings(use_mock_market=True))

    assert brief == market_brief("Chennai")
    assert queries == []


def test_datasphere_is_still_one_setting_away(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    def fake(city: str, settings: Settings) -> dict[str, Any]:
        seen.append(city)
        return {"source": "live", "provider": "sap_datasphere"}

    monkeypatch.setattr(datasphere, "market_brief", fake)

    brief = market_radar.market_brief("Chennai", hana_settings(market_provider="datasphere"))

    assert brief["provider"] == "sap_datasphere"
    assert seen == ["Chennai"]


def test_a_slow_read_times_out_to_the_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    import time

    install_hana(monkeypatch)

    def slow(settings: Settings, sql: str, parameters: Any = None) -> list[dict[str, Any]]:
        time.sleep(1.0)
        return table_rows()

    monkeypatch.setattr(hana_client, "run_query", slow)
    settings = hana_settings(hana_query_timeout_seconds=0.1)

    brief = asyncio.run(market_radar.market_brief_async("Chennai", settings))

    assert brief == market_brief("Chennai")


def test_health_names_hana_as_the_market_source(tmp_path: Path) -> None:
    settings = hana_settings(database_path=tmp_path / "reroute.db")
    with TestClient(create_app(settings)) as client:
        market = client.get("/health").json()["market"]

    assert market["mode"] == "live"
    assert market["integration_status"] == "configured"
    assert market["provider"] == "sap_hana_cloud"
