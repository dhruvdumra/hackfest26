import json
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.emi_bug_hunt import (
    BUG_HUNT_CREDENTIAL,
    BUG_HUNT_SKILL_ID,
    PLANTED_BUGS,
    BugHuntSubmission,
    grade,
    parse_submission,
)
from app.main import create_app

NOTE = "EMI looks wrong here"


def finding(
    principal: float = 500_000,
    annual_rate: float = 9,
    tenure: float = 60,
    tenure_unit: str = "months",
    note: str = NOTE,
) -> dict[str, Any]:
    return {
        "principal": principal,
        "annual_rate": annual_rate,
        "tenure": tenure,
        "tenure_unit": tenure_unit,
        "note": note,
    }


# One reproduction per planted bug, each triggering exactly that bug.
REPRODUCTIONS: dict[str, dict[str, Any]] = {
    "zero-rate": finding(annual_rate=0),
    "years-as-months": finding(tenure=5, tenure_unit="years"),
    "negative-principal": finding(principal=-500_000),
    "decimal-rate": finding(annual_rate=8.5),
    "crore-format": finding(principal=12_000_000),
}


def report(*findings: dict[str, Any]) -> BugHuntSubmission:
    return BugHuntSubmission.model_validate({"sample": "emi-bug-hunt", "findings": list(findings)})


def test_every_planted_bug_has_a_reproduction_that_triggers_only_it() -> None:
    assert {bug.bug_id for bug in PLANTED_BUGS} == set(REPRODUCTIONS)
    for bug_id, inputs in REPRODUCTIONS.items():
        graded = grade(report(inputs))
        assert [bug.bug_id for bug in graded.found] == [bug_id]
        assert graded.false_reports == 0


def test_a_clean_input_reproduces_nothing_and_counts_as_a_false_report() -> None:
    graded = grade(report(finding()))
    assert graded.found == ()
    assert graded.false_reports == 1
    assert graded.score == 0


def test_score_is_the_share_of_bugs_found_minus_false_reports() -> None:
    four = [REPRODUCTIONS[key] for key in list(REPRODUCTIONS)[:4]]
    assert grade(report(*four)).score == 80
    assert grade(report(*four, finding())).score == 70
    assert grade(report(*REPRODUCTIONS.values())).score == 100


def test_a_bug_found_twice_counts_once_and_a_finding_without_a_note_is_ignored() -> None:
    graded = grade(
        report(REPRODUCTIONS["zero-rate"], REPRODUCTIONS["zero-rate"], finding(note="  "))
    )
    assert [bug.bug_id for bug in graded.found] == ["zero-rate"]
    assert graded.false_reports == 0


def test_malformed_reports_are_rejected_with_a_readable_message() -> None:
    with pytest.raises(ValueError, match="must be JSON"):
        parse_submission("I found some bugs")
    with pytest.raises(ValueError, match="malformed"):
        parse_submission(json.dumps({"sample": "emi-bug-hunt", "findings": [{"principal": 1}]}))


def test_the_endpoint_grades_the_hunt_and_records_the_credential(tmp_path: Path) -> None:
    app = create_app(Settings(database_path=tmp_path / "reroute.db"))
    four = [REPRODUCTIONS[key] for key in list(REPRODUCTIONS)[:4]]
    with TestClient(app) as client:
        started = client.post(
            "/session/start",
            json={"input_type": "text", "content": "I was a manual tester.", "persona": "Kavya"},
        ).json()
        session_id = started["session_id"]
        # Wait for the run to reach the consent gate, as it has on stage by the
        # time anyone opens the bug hunt: the passport exists and the
        # orchestrator has stopped writing the session.
        for _ in range(300):
            if client.get(f"/session/{session_id}").json()["status"] == "waiting":
                break
            time.sleep(0.02)
        response = client.post(
            "/skills/work-sample",
            json={
                "skill_id": BUG_HUNT_SKILL_ID,
                "submission": json.dumps({"sample": "emi-bug-hunt", "findings": four}),
                "session_id": session_id,
            },
        )
        passport = client.get(f"/session/{session_id}").json()["passport"]

    assert response.status_code == 200
    body = response.json()
    assert body["score"] == 80
    assert body["credential_issued"] is True
    assert body["credential"] == BUG_HUNT_CREDENTIAL
    assert body["bugs_total"] == 5
    assert len(body["bugs_found"]) == 4
    assert body["false_reports"] == 0
    # Graded in-process against planted bugs: local, never simulated or live.
    assert body["source"] == "local"
    assert BUG_HUNT_CREDENTIAL in passport["credentials"]


def test_the_endpoint_rejects_a_malformed_hunt_and_leaves_other_skills_alone(
    tmp_path: Path,
) -> None:
    app = create_app(Settings(database_path=tmp_path / "reroute.db"))
    with TestClient(app) as client:
        malformed = client.post(
            "/skills/work-sample",
            json={"skill_id": BUG_HUNT_SKILL_ID, "submission": "not json"},
        )
        other = client.post(
            "/skills/work-sample",
            json={"skill_id": "API testing", "submission": "A Postman collection for payments."},
        )

    assert malformed.status_code == 422
    assert "must be JSON" in malformed.json()["detail"]
    assert other.status_code == 200
    assert "bugs_total" not in other.json()
    assert other.json()["source"] == "simulated"
