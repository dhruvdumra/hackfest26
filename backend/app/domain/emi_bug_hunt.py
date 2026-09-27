"""The EMI bug hunt: the 15-minute work sample from the pitch deck, graded for real.

The frontend ships a loan-EMI calculator with five planted bugs. The worker
tries inputs, and each time she sees something wrong she logs a finding: the
exact inputs that reproduce it, plus a note on what looks wrong. This module
holds the same bug catalogue and re-runs every reported reproduction against
it, so a finding earns credit only if its inputs actually trigger a planted
bug. Nothing here is an LLM guess or a word count: the same report always
scores the same.

Scoring: 100 points shared across the planted bugs, minus a penalty per false
report (inputs that trigger nothing), clamped to 0..100. A finding without a
note is not a bug report and is ignored rather than penalised.
"""

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

BUG_HUNT_SKILL_ID: Final[str] = "emi-bug-hunt"
BUG_HUNT_CREDENTIAL: Final[str] = "Defect reproduction"
FALSE_REPORT_PENALTY: Final[int] = 10
MIN_NOTE_LENGTH: Final[int] = 3
CRORE: Final[float] = 10_000_000


class BugHuntFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    principal: float = Field(ge=-1e12, le=1e12)
    annual_rate: float = Field(ge=-100, le=100)
    tenure: float = Field(ge=0, le=1200)
    tenure_unit: Literal["months", "years"]
    note: str = Field(default="", max_length=500)


class BugHuntSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sample: Literal["emi-bug-hunt"]
    findings: list[BugHuntFinding] = Field(max_length=25)


@dataclass(frozen=True, slots=True)
class PlantedBug:
    bug_id: str
    title: str
    triggers: Callable[[BugHuntFinding], bool]


PLANTED_BUGS: Final[tuple[PlantedBug, ...]] = (
    PlantedBug(
        "zero-rate",
        "Divides by zero at a 0% interest rate",
        lambda finding: finding.annual_rate == 0 and finding.tenure > 0,
    ),
    PlantedBug(
        "years-as-months",
        "Reads a tenure in years as months",
        lambda finding: finding.tenure_unit == "years" and finding.tenure > 1,
    ),
    PlantedBug(
        "negative-principal",
        "Accepts a negative loan amount",
        lambda finding: finding.principal < 0,
    ),
    PlantedBug(
        "decimal-rate",
        "Drops the decimal part of the interest rate",
        lambda finding: finding.annual_rate != 0 and finding.annual_rate % 1 != 0,
    ),
    PlantedBug(
        "crore-format",
        "Truncates amounts of a crore or more",
        lambda finding: finding.principal >= CRORE,
    ),
)


@dataclass(frozen=True, slots=True)
class BugHuntScore:
    score: int
    found: tuple[PlantedBug, ...]
    false_reports: int
    total: int


def parse_submission(raw: str) -> BugHuntSubmission:
    """Parse the JSON report, raising ValueError with a readable message."""
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as error:
        raise ValueError("the bug report must be JSON") from error
    try:
        return BugHuntSubmission.model_validate(payload)
    except ValidationError as error:
        raise ValueError(f"the bug report is malformed: {error.errors()[0]['msg']}") from error


def grade(submission: BugHuntSubmission) -> BugHuntScore:
    found: dict[str, PlantedBug] = {}
    false_reports = 0
    for finding in submission.findings:
        if len(finding.note.strip()) < MIN_NOTE_LENGTH:
            continue
        triggered = [bug for bug in PLANTED_BUGS if bug.triggers(finding)]
        if not triggered:
            false_reports += 1
        for bug in triggered:
            found.setdefault(bug.bug_id, bug)
    total = len(PLANTED_BUGS)
    raw_score = round(100 * len(found) / total) - FALSE_REPORT_PENALTY * false_reports
    ordered = tuple(bug for bug in PLANTED_BUGS if bug.bug_id in found)
    return BugHuntScore(
        score=max(0, min(100, raw_score)),
        found=ordered,
        false_reports=false_reports,
        total=total,
    )
