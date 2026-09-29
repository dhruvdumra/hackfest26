"""The hiring manager's sign-off on a rewritten job post."""

from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

POST_ID = "post-chennai-qa-analyst-118"


def build_client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings(database_path=tmp_path / "reroute.db")))


def decide(client: TestClient, approved: object, post_id: str = POST_ID) -> dict[str, object]:
    response = client.post(
        f"/employer/rewrite-filter/{post_id}/decision", json={"approved": approved}
    )
    return {"status": response.status_code, "body": response.json()}


def test_approving_publishes_the_rewritten_post(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        result = decide(client, True)

    assert result["status"] == 200
    body = result["body"]
    assert isinstance(body, dict)
    assert body["job_post_id"] == POST_ID
    assert body["decision"] == "approved"
    assert body["message"] == "Published by hiring manager"
    assert body["decided_at"]
    assert body["source"] == "local"


def test_rejecting_keeps_the_rewrite_unpublished(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        result = decide(client, False)

    body = result["body"]
    assert isinstance(body, dict)
    assert body["decision"] == "rejected"
    assert body["message"] == "Rejected by hiring manager · the rewrite is not published"


def test_the_latest_decision_can_be_read_back_and_changed(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        before = client.get(f"/employer/rewrite-filter/{POST_ID}/decision")
        decide(client, False)
        decide(client, True)
        after = client.get(f"/employer/rewrite-filter/{POST_ID}/decision")

    assert before.status_code == 404
    assert after.status_code == 200
    assert after.json()["decision"] == "approved"


def test_decisions_are_kept_per_post(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        decide(client, True)
        other = client.get("/employer/rewrite-filter/post-chennai-support-lead-207/decision")

    assert other.status_code == 404


def test_an_unknown_post_is_404(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        post = decide(client, True, post_id="post-nowhere-000")
        get = client.get("/employer/rewrite-filter/post-nowhere-000/decision")

    assert post["status"] == 404
    assert get.status_code == 404


def test_the_decision_must_be_a_boolean(tmp_path: Path) -> None:
    with build_client(tmp_path) as client:
        not_bool = decide(client, "yes")
        missing = client.post(f"/employer/rewrite-filter/{POST_ID}/decision", json={})

    assert not_bool["status"] == 422
    assert missing.status_code == 422
