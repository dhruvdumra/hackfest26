"""Market Intelligence reading the radar from an SAP Datasphere view.

No network: a fake hdbcli connection answers. The contract under test:

  * mock mode, or missing connection details, never touch Datasphere
  * a good read is labelled live and tells the same story as the fixture
  * any failure (driver error, timeout, unusable rows) is the labelled fixture
  * the CSV we upload to Datasphere is exactly the fixture, so the deck's
    "4 radar rows · 28 openings in Chennai" survives the move
"""

from __future__ import annotations

import asyncio
import csv
import time
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.mocks.market_fixtures import DISPLACEMENT_RADAR, market_brief
from app.services import datasphere

CSV_PATH = Path(__file__).resolve().parents[2] / "docs" / "datasphere" / "market_radar.csv"
COLUMNS = ("RANK", "ROLE", "CITY", "EXPOSURE", "DEMAND", "OPENINGS", "MEDIAN_PAY", "SIGNAL")


def fixture_rows() -> list[tuple[Any, ...]]:
    return [
        (
            rank,
            entry["role"],
            entry["city"],
            entry["exposure"],
            entry["demand"],
            entry["openings"],
            entry["median_pay"],
            entry["signal"],
        )
        for rank, entry in enumerate(DISPLACEMENT_RADAR, start=1)
    ]


def live_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "use_mock_market": False,
        "market_provider": "datasphere",
        "datasphere_host": "tenant.hana.prod-eu10.hanacloud.ondemand.com",
        "datasphere_user": "REROUTE#READER",
        "datasphere_password": "not-a-real-password",
        "datasphere_schema": "REROUTE",
        "datasphere_view": "MARKET_RADAR_V",
    }
    values.update(overrides)
    return Settings(**values)


class FakeCursor:
    def __init__(self, columns: tuple[str, ...], rows: list[tuple[Any, ...]]) -> None:
        self.description = [(name,) for name in columns]
        self._rows = rows
        self.sql: list[str] = []

    def execute(self, sql: str) -> None:
        self.sql.append(sql)

    def fetchall(self) -> list[tuple[Any, ...]]:
        return self._rows

    def close(self) -> None:
        pass


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor
        self.closed = False

    def cursor(self) -> FakeCursor:
        return self._cursor

    def close(self) -> None:
        self.closed = True


def install(
    monkeypatch: pytest.MonkeyPatch,
    columns: tuple[str, ...] = COLUMNS,
    rows: list[tuple[Any, ...]] | None = None,
) -> dict[str, Any]:
    seen: dict[str, Any] = {"connects": 0}
    cursor = FakeCursor(columns, fixture_rows() if rows is None else rows)

    def connect(settings: Settings) -> FakeConnection:
        connection = FakeConnection(cursor)
        seen["connects"] += 1
        seen["connection"] = connection
        return connection

    monkeypatch.setattr(datasphere, "_connect", connect)
    seen["cursor"] = cursor
    return seen


def test_mock_mode_serves_the_fixture_without_connecting(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = install(monkeypatch)

    brief = datasphere.market_brief("Chennai", Settings())

    assert brief == market_brief("Chennai")
    assert seen["connects"] == 0


def test_missing_details_serve_the_fixture_without_connecting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen = install(monkeypatch)

    brief = datasphere.market_brief("Chennai", live_settings(datasphere_view=""))

    assert brief["source"] == "simulated"
    assert seen["connects"] == 0


def test_a_good_read_is_live_and_tells_the_same_story(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = install(monkeypatch)

    brief = datasphere.market_brief("Chennai", live_settings())

    fixture = market_brief("Chennai")
    assert brief["source"] == "live"
    assert brief["provider"] == "sap_datasphere"
    assert brief["entry_count"] == 4
    assert brief["openings"] == 28
    assert brief["entries"] == fixture["entries"]
    assert seen["cursor"].sql == ['SELECT * FROM "REROUTE"."MARKET_RADAR_V"']
    assert seen["connection"].closed is True


def test_column_names_are_matched_whatever_their_case(monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, columns=tuple(name.lower() for name in COLUMNS))

    brief = datasphere.market_brief("chennai", live_settings())

    assert brief["source"] == "live"
    assert brief["openings"] == 28


def test_rows_keep_the_view_rank_not_the_driver_order(monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, rows=list(reversed(fixture_rows())))

    brief = datasphere.market_brief("Chennai", live_settings())

    assert roles_of(brief) == roles_of(market_brief("Chennai"))


def roles_of(brief: dict[str, Any]) -> list[str]:
    return [str(entry["role"]) for entry in cast(list[dict[str, Any]], brief["entries"])]


def test_a_driver_error_serves_the_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(settings: Settings) -> FakeConnection:
        raise RuntimeError("tenant asleep")

    monkeypatch.setattr(datasphere, "_connect", broken)

    brief = datasphere.market_brief("Chennai", live_settings())

    assert brief == market_brief("Chennai")


def test_unusable_rows_serve_the_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    bad = [(1, "qa-analyst", "Chennai", "extreme", "growing", "many", 1, "x")]
    install(monkeypatch, rows=bad)

    brief = datasphere.market_brief("Chennai", live_settings())

    assert brief["source"] == "simulated"


def test_an_unsafe_identifier_is_never_sent(monkeypatch: pytest.MonkeyPatch) -> None:
    seen = install(monkeypatch)

    brief = datasphere.market_brief("Chennai", live_settings(datasphere_view='V"; DROP TABLE X'))

    assert brief["source"] == "simulated"
    assert seen["connects"] == 0


def test_a_slow_read_times_out_to_the_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    def slow(settings: Settings) -> FakeConnection:
        time.sleep(1.0)
        raise AssertionError("should have timed out first")

    monkeypatch.setattr(datasphere, "_connect", slow)
    settings = live_settings(datasphere_timeout_seconds=0.1)

    brief = asyncio.run(datasphere.market_brief_async("Chennai", settings))

    assert brief == market_brief("Chennai")


def test_the_upload_csv_is_exactly_the_fixture() -> None:
    with CSV_PATH.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.reader(handle))

    assert tuple(rows[0]) == COLUMNS
    assert [tuple(row) for row in rows[1:]] == [
        tuple(str(value) for value in row) for row in fixture_rows()
    ]


def test_health_reports_market_mode(tmp_path: Path) -> None:
    with TestClient(create_app(Settings(database_path=tmp_path / "a.db"))) as client:
        mock = client.get("/health").json()["market"]
    live = live_settings(database_path=tmp_path / "b.db")
    with TestClient(create_app(live)) as client:
        configured = client.get("/health").json()["market"]

    assert mock == {"mode": "mock", "source": "simulated", "integration_status": "not_implemented"}
    assert configured["mode"] == "live"
    assert configured["integration_status"] == "configured"
    assert configured["provider"] == "sap_datasphere"
    assert "not-a-real-password" not in str(configured)
