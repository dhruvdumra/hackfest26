from datetime import UTC, datetime
from typing import Annotated, Any, cast
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Path, Query, status

from app.api.dependencies import DecisionStoreDependency
from app.mocks import employer_fixtures, market_fixtures
from app.models import (
    ROLE_QUERY_MAX_LENGTH,
    DisplacementRadarResponse,
    EmployerDecisionRecord,
    EmployerDecisionRequest,
    EmployerFilterRewriteRequest,
    EmployerFilterRewriteResponse,
)

router = APIRouter(tags=["market", "employer"])

RoleQuery = Annotated[str, Query(min_length=1, max_length=ROLE_QUERY_MAX_LENGTH)]
CityQuery = Annotated[str, Query(min_length=1, max_length=ROLE_QUERY_MAX_LENGTH)]
JobPostPath = Annotated[str, Path(min_length=1, max_length=120)]


@router.get("/market/displacement-radar", response_model=DisplacementRadarResponse)
def displacement_radar(
    role: RoleQuery,
    city: CityQuery = market_fixtures.DEFAULT_CITY,
) -> DisplacementRadarResponse:
    entry = _radar_entry(role, city)
    return DisplacementRadarResponse(
        role=entry["role"],
        city=entry["city"],
        exposure=entry["exposure"],
        demand=entry["demand"],
        disclaimer=market_fixtures.DISCLAIMER,
    )


@router.post(
    "/employer/rewrite-filter",
    response_model=EmployerFilterRewriteResponse,
)
def rewrite_filter(
    request: EmployerFilterRewriteRequest,
) -> EmployerFilterRewriteResponse:
    post = _job_post(request.job_post_id)
    return EmployerFilterRewriteResponse(
        job_post_id=post["post_id"],
        role=post["role"],
        city=post["city"],
        filter_text_before=post["filter_text_before"],
        filter_text_after=post["filter_text_after"],
        restrictive_phrase=post["restrictive_phrase"],
        removed_criteria=list(post["removed_criteria"]),
        hidden_talent_count=post["hidden_talent_count"],
        rewrite_reason=post["rewrite_reason"],
        disclaimer=employer_fixtures.DISCLAIMER,
    )


@router.post(
    "/employer/rewrite-filter/{job_post_id}/decision",
    response_model=EmployerDecisionRecord,
    status_code=status.HTTP_201_CREATED,
)
async def decide_rewrite(
    job_post_id: JobPostPath,
    request: EmployerDecisionRequest,
    decisions: DecisionStoreDependency,
) -> EmployerDecisionRecord:
    """Record the hiring manager's sign-off on a rewritten post: the second key.

    The agent drafts the rewrite; nothing is published on its say-so. Every
    decision is a new row, so approving and then rejecting leaves both on record.
    """
    post = _job_post(job_post_id)
    record = EmployerDecisionRecord(
        decision_id=f"decision-{uuid4().hex[:12]}",
        job_post_id=post["post_id"],
        decision=request.decision,
        reviewer=request.reviewer.strip() or "Hiring manager",
        note=request.note.strip() if request.note and request.note.strip() else None,
        decided_at=datetime.now(UTC),
        hidden_talent_count=post["hidden_talent_count"],
    )
    await decisions.record(record)
    return record


@router.get(
    "/employer/rewrite-filter/{job_post_id}/decision",
    response_model=EmployerDecisionRecord,
)
async def latest_rewrite_decision(
    job_post_id: JobPostPath,
    decisions: DecisionStoreDependency,
) -> EmployerDecisionRecord:
    post = _job_post(job_post_id)
    record = await decisions.latest(post["post_id"])
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No decision has been recorded for this job post yet",
        )
    return record


def _job_post(job_post_id: str) -> dict[str, Any]:
    post = employer_fixtures.JOB_POSTS_BY_ID.get(job_post_id)
    if post is None:
        known = ", ".join(sorted(employer_fixtures.JOB_POSTS_BY_ID))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"unknown job_post_id; expected one of: {known}",
        )
    return cast(dict[str, Any], post)


def _radar_entry(role: str, city: str) -> dict[str, Any]:
    wanted_role = role.strip().casefold()
    wanted_city = city.strip().casefold()
    for entry in market_fixtures.DISPLACEMENT_RADAR:
        if entry["role"].casefold() != wanted_role:
            continue
        if entry["city"].casefold() == wanted_city:
            return cast(dict[str, Any], entry)
    known = ", ".join(sorted({entry["role"] for entry in market_fixtures.DISPLACEMENT_RADAR}))
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"no simulated radar entry for role {role!r} in {city!r}; expected one of: {known}",
    )
