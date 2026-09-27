from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.mocks.employer_fixtures import JOB_POSTS

POST = JOB_POSTS[0]
DECISION_PATH = f"/employer/rewrite-filter/{POST['post_id']}/decision"


def build_client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings(database_path=tmp_path / "reroute.db")))


def test_a_hiring_manager_approval_is_recorded_and_labelled_simulated(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        response = client.post(
            DECISION_PATH,
            json={"decision": "approve", "reviewer": "Priya (HR)", "note": "  Publish it.  "},
        )

    assert response.status_code == 201
    record = response.json()
    assert record["job_post_id"] == POST["post_id"]
    assert record["decision"] == "approve"
    assert record["reviewer"] == "Priya (HR)"
    assert record["note"] == "Publish it."
    assert record["hidden_talent_count"] == POST["hidden_talent_count"]
    assert record["decision_id"].startswith("decision-")
    # The post is a fixture, so the sign-off on it cannot claim to be live.
    assert record["source"] == "simulated"


def test_the_latest_decision_survives_a_restart_and_a_reversal_keeps_both(
    tmp_path: Path,
) -> None:
    with build_client(tmp_path) as client:
        first = client.post(DECISION_PATH, json={"decision": "approve"}).json()
        second = client.post(DECISION_PATH, json={"decision": "reject"}).json()

    assert first["decision_id"] != second["decision_id"]
    assert first["reviewer"] == "Hiring manager"

    with build_client(tmp_path) as client:
        latest = client.get(DECISION_PATH)

    assert latest.status_code == 200
    assert latest.json()["decision_id"] == second["decision_id"]
    assert latest.json()["decision"] == "reject"


def test_no_decision_yet_is_a_404_not_an_implied_approval(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        response = client.get(DECISION_PATH)

    assert response.status_code == 404
    assert "No decision" in response.json()["detail"]


def test_unknown_posts_and_unknown_decisions_are_rejected(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        unknown_post = client.post(
            "/employer/rewrite-filter/post-nowhere/decision",
            json={"decision": "approve"},
        )
        unknown_decision = client.post(DECISION_PATH, json={"decision": "auto-approve"})
        blank_reviewer = client.post(DECISION_PATH, json={"decision": "approve", "reviewer": ""})

    assert unknown_post.status_code == 404
    assert "expected one of" in unknown_post.json()["detail"]
    assert unknown_decision.status_code == 422
    assert blank_reviewer.status_code == 422
