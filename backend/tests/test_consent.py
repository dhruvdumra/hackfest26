"""The Two-Key consent step: the run waits for Kavya, then shares or not."""

import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

WAIT_SECONDS = 30.0
POLL_SECONDS = 0.05


def build_client(tmp_path: Path, consent_timeout_seconds: float = 30.0) -> TestClient:
    settings = Settings(
        database_path=tmp_path / "reroute.db",
        consent_timeout_seconds=consent_timeout_seconds,
    )
    return TestClient(create_app(settings))


def start_run(client: TestClient) -> str:
    response = client.post(
        "/session/start",
        json={"input_type": "text", "content": "I did manual testing.", "persona": "Kavya"},
    )
    assert response.status_code == 200
    return cast(str, response.json()["session_id"])


def wait_for(
    client: TestClient, session_id: str, done: Callable[[dict[str, Any]], bool]
) -> dict[str, Any]:
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        session = cast(dict[str, Any], client.get(f"/session/{session_id}").json())
        if done(session):
            return session
        time.sleep(POLL_SECONDS)
    pytest.fail(f"session {session_id} never reached the expected state")


def is_waiting(session: dict[str, Any]) -> bool:
    # The status flips just before the event lands, so wait for both.
    return bool(
        session["status"] == "waiting"
        and session["events"]
        and session["events"][-1]["status"] == "waiting_consent"
    )


def is_completed(session: dict[str, Any]) -> bool:
    return bool(session["status"] == "completed")


def last_event(session: dict[str, Any]) -> dict[str, Any]:
    return cast(dict[str, Any], session["events"][-1])


def test_the_run_waits_for_consent_instead_of_accepting_it(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        session_id = start_run(client)
        waiting = wait_for(client, session_id, is_waiting)
        client.post(f"/session/{session_id}/consent", json={"accepted": False})
        wait_for(client, session_id, is_completed)

    assert last_event(waiting)["status"] == "waiting_consent"
    assert last_event(waiting)["data"]["blocking"] is True
    assert waiting["state"]["consent"]["state"] == "pending"


def test_yes_shares_the_passport_and_completes_the_run(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        session_id = start_run(client)
        wait_for(client, session_id, is_waiting)
        response = client.post(f"/session/{session_id}/consent", json={"accepted": True})
        completed = wait_for(client, session_id, is_completed)

    assert response.status_code == 200
    assert response.json()["consent"] == "accepted"
    assert completed["state"]["consent"]["state"] == "accepted"
    assert completed["state"]["consent"]["decided_at"]
    final = last_event(completed)
    assert final["agent"] == "ORCHESTRATOR"
    assert final["status"] == "done"
    assert final["data"]["consent"] == "accepted"
    assert "shared with employers" in final["message"]


def test_no_keeps_the_passport_private(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        session_id = start_run(client)
        wait_for(client, session_id, is_waiting)
        response = client.post(f"/session/{session_id}/consent", json={"accepted": False})
        completed = wait_for(client, session_id, is_completed)

    assert response.json()["consent"] == "declined"
    assert completed["state"]["consent"]["state"] == "declined"
    assert last_event(completed)["data"]["consent"] == "declined"
    assert "stays private" in last_event(completed)["message"]


def test_no_answer_times_out_and_shares_nothing(tmp_path: Path) -> None:
    with build_client(tmp_path, consent_timeout_seconds=0.2) as client:
        session_id = start_run(client)
        completed = wait_for(client, session_id, is_completed)
        late = client.post(f"/session/{session_id}/consent", json={"accepted": True})

    assert completed["state"]["consent"]["state"] == "timed_out"
    assert last_event(completed)["data"]["consent"] == "timed_out"
    assert "nothing was shared" in last_event(completed)["message"]
    # A late click cannot flip a closed decision.
    assert late.status_code == 409


def test_a_second_answer_is_rejected(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        session_id = start_run(client)
        wait_for(client, session_id, is_waiting)
        first = client.post(f"/session/{session_id}/consent", json={"accepted": False})
        second = client.post(f"/session/{session_id}/consent", json={"accepted": True})
        completed = wait_for(client, session_id, is_completed)

    assert first.status_code == 200
    assert second.status_code == 409
    assert completed["state"]["consent"]["state"] == "declined"


def test_consent_for_an_unknown_session_is_404(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        response = client.post("/session/no-such-session/consent", json={"accepted": True})

    assert response.status_code == 404


def test_consent_needs_a_boolean_answer(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        session_id = start_run(client)
        missing = client.post(f"/session/{session_id}/consent", json={})
        not_bool = client.post(f"/session/{session_id}/consent", json={"accepted": "maybe"})
        wait_for(client, session_id, is_waiting)
        client.post(f"/session/{session_id}/consent", json={"accepted": False})
        wait_for(client, session_id, is_completed)

    assert missing.status_code == 422
    assert not_bool.status_code == 422
