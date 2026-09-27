import asyncio
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import SessionState
from app.storage.session_store import SessionStore

TRANSCRIPT = (
    "I worked four years as a manual tester. I owned regression testing and defect "
    "reproduction, and kept Postman collections for API testing."
)
WAIT_SECONDS = 30.0
POLL_SECONDS = 0.05


def build_client(tmp_path: Path) -> TestClient:
    return TestClient(
        create_app(
            Settings(
                database_path=tmp_path / "reroute.db",
                use_mock_hana=True,
                use_mock_genai=True,
            )
        )
    )


def start_and_wait_for_consent(client: TestClient) -> dict[str, Any]:
    started = client.post(
        "/session/start",
        json={"input_type": "text", "content": TRANSCRIPT, "persona": "Kavya"},
    )
    assert started.status_code == 200
    session_id = cast(str, started.json()["session_id"])
    deadline = time.perf_counter() + WAIT_SECONDS
    payload: dict[str, Any] = {}
    while time.perf_counter() < deadline:
        payload = cast(dict[str, Any], client.get(f"/session/{session_id}").json())
        events = cast(list[dict[str, Any]], payload["events"])
        # The gate parks the session before it announces the wait, so the run
        # has settled only once the waiting_consent event is persisted too.
        settled = bool(events) and events[-1]["status"] == "waiting_consent"
        if payload["status"] == "failed" or (payload["status"] == "waiting" and settled):
            break
        time.sleep(POLL_SECONDS)
    assert payload["status"] == "waiting", "the run never reached the consent gate"
    return payload


def consent_path(session_id: str) -> str:
    return f"/session/{session_id}/consent"


def test_the_run_waits_for_a_person_and_approval_completes_it(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        waiting = start_and_wait_for_consent(client)
        session_id = cast(str, waiting["session_id"])
        assert waiting["state"]["consent"]["state"] == "pending"
        assert waiting["events"][-1]["status"] == "waiting_consent"

        response = client.post(consent_path(session_id), json={"decision": "approve"})
        after = cast(dict[str, Any], client.get(f"/session/{session_id}").json())

    assert response.status_code == 200
    receipt = response.json()
    assert receipt["decision"] == "approve"
    assert receipt["state"] == "approved"
    assert receipt["actor"] == "Kavya"
    assert receipt["purpose"]
    assert receipt["keys"] == ["evidence_disclosure", "plan_acceptance"]
    assert receipt["receipt_id"].startswith("consent-")
    # A person decided this, in this app: it is local, never simulated or live.
    assert receipt["source"] == "local"

    assert after["status"] == "completed"
    assert after["state"]["consent"]["state"] == "approved"
    assert after["state"]["consent"]["receipt_id"] == receipt["receipt_id"]
    assert [item["receipt_id"] for item in after["state"]["consent_receipts"]] == [
        receipt["receipt_id"]
    ]
    closing = after["events"][-1]
    assert closing["agent"] == "ORCHESTRATOR"
    assert closing["status"] == "done"
    assert closing["source"] == "local"
    assert closing["data"]["phase"] == "two_key_consent"
    assert closing["data"]["receipt_id"] == receipt["receipt_id"]
    assert closing["sequence"] == after["events"][-2]["sequence"] + 1


def test_consent_is_revocable_and_every_decision_keeps_a_receipt(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        session_id = cast(str, start_and_wait_for_consent(client)["session_id"])
        approved = client.post(consent_path(session_id), json={"decision": "approve"})
        repeat = client.post(consent_path(session_id), json={"decision": "approve"})
        revoked = client.post(
            consent_path(session_id), json={"decision": "revoke", "actor": "Kavya R."}
        )
        revoked_again = client.post(consent_path(session_id), json={"decision": "revoke"})
        after = cast(dict[str, Any], client.get(f"/session/{session_id}").json())

    assert approved.status_code == 200
    assert repeat.status_code == 409
    assert "already approved" in repeat.json()["detail"]
    assert revoked.status_code == 200
    assert revoked.json()["state"] == "revoked"
    assert revoked.json()["actor"] == "Kavya R."
    assert revoked_again.status_code == 409

    assert after["state"]["consent"]["state"] == "revoked"
    assert [item["decision"] for item in after["state"]["consent_receipts"]] == [
        "approve",
        "revoke",
    ]
    assert "revoked consent" in after["events"][-1]["message"]


def test_a_pending_request_can_be_declined_outright(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        session_id = cast(str, start_and_wait_for_consent(client)["session_id"])
        declined = client.post(consent_path(session_id), json={"decision": "revoke"})

    assert declined.status_code == 200
    assert declined.json()["state"] == "revoked"


def test_consent_cannot_be_given_before_it_is_asked_for(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "reroute.db"))
    now = datetime.now(UTC)
    fresh = SessionState(
        session_id="not-asked-yet",
        input_type="text",
        content=TRANSCRIPT,
        persona="Kavya",
        status="running",
        source="simulated",
        state={},
        version=0,
        created_at=now,
        updated_at=now,
    )

    async def persist() -> None:
        store = cast(SessionStore, app.state.session_store)
        await store.initialize()
        await store.create(fresh)

    asyncio.run(persist())
    with TestClient(app) as client:
        early = client.post(consent_path("not-asked-yet"), json={"decision": "approve"})
        missing = client.post(consent_path("no-such-session"), json={"decision": "approve"})
        malformed = client.post(consent_path("not-asked-yet"), json={"decision": "maybe"})

    assert early.status_code == 409
    assert "has not asked for consent" in early.json()["detail"]
    assert missing.status_code == 404
    assert malformed.status_code == 422


def test_a_connected_console_sees_the_decision_land(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        waiting = start_and_wait_for_consent(client)
        session_id = cast(str, waiting["session_id"])
        history = len(waiting["events"])
        with client.websocket_connect(f"/session/{session_id}/stream") as socket:
            replayed = [cast(dict[str, Any], socket.receive_json()) for _ in range(history)]
            client.post(consent_path(session_id), json={"decision": "approve"})
            live = cast(dict[str, Any], socket.receive_json())

    assert replayed[-1]["status"] == "waiting_consent"
    assert live["status"] == "done"
    assert live["data"]["phase"] == "two_key_consent"
    assert live["sequence"] == replayed[-1]["sequence"] + 1
