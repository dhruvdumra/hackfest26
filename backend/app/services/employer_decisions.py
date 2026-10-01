"""The hiring manager's approve / reject on a rewritten job post.

Kept in process memory: the backend runs as a single instance, and its SQLite
file does not survive a Cloud Foundry restart either, so a table would promise
durability the demo host cannot give. The latest decision per post wins.
"""

from datetime import UTC, datetime
from typing import Final

from app.models import EmployerDecision

DECISION_MESSAGES: Final[dict[bool, str]] = {
    True: "Published by hiring manager",
    False: "Rejected by hiring manager · the rewrite is not published",
}


class EmployerDecisionLog:
    def __init__(self) -> None:
        self._latest: dict[str, EmployerDecision] = {}

    def record(self, job_post_id: str, approved: bool) -> EmployerDecision:
        decision = EmployerDecision(
            job_post_id=job_post_id,
            decision="approved" if approved else "rejected",
            message=DECISION_MESSAGES[approved],
            decided_at=datetime.now(UTC).isoformat(),
        )
        self._latest[job_post_id] = decision
        return decision

    def latest(self, job_post_id: str) -> EmployerDecision | None:
        return self._latest.get(job_post_id)
