from typing import Annotated, Any, cast

from fastapi import APIRouter, HTTPException, Query, status

from app.api.dependencies import EmployerDecisionsDependency, SettingsDependency
from app.mocks import market_fixtures
from app.mocks.employer_fixtures import JOB_POSTS_BY_ID
from app.models import (
    ROLE_QUERY_MAX_LENGTH,
    DisplacementRadarResponse,
    EmployerDecision,
    EmployerDecisionRequest,
    EmployerFilterRewriteRequest,
    EmployerFilterRewriteResponse,
)
from app.services import employer_rewrite

router = APIRouter(tags=["market", "employer"])

RoleQuery = Annotated[str, Query(min_length=1, max_length=ROLE_QUERY_MAX_LENGTH)]
CityQuery = Annotated[str, Query(min_length=1, max_length=ROLE_QUERY_MAX_LENGTH)]


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
    settings: SettingsDependency,
) -> EmployerFilterRewriteResponse:
    """Rewrite a job post's filter, ideally from the audit that flagged it.

    When ``audit_result`` is supplied and carries a non-zero delta, the rewrite
    is derived from that finding: the model is told which attributes actually
    cost the candidate points and asked to remove that wording. The response
    then carries ``source="live"`` and ``derived_from_audit=True``.

    Without an audit, or with an audit that found nothing, there is no finding to
    act on, so the bundled fixture answers and says ``derived_from_audit=False``.
    That flag is the honest one: the fixture text happens to read well, but it
    was not produced by this request, and a reviewer checking the payload should
    be able to see that without reading prose.
    """
    try:
        rewrite = employer_rewrite.rewrite_filter(
            request.job_post_id,
            settings=settings,
            audit_result=request.audit_result,
        )
    except employer_rewrite.EmployerRewriteUnavailableError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error
    return EmployerFilterRewriteResponse(**rewrite)


@router.post(
    "/employer/rewrite-filter/{job_post_id}/decision",
    response_model=EmployerDecision,
    responses={404: {"description": "Unknown job post"}},
)
def decide_rewrite(
    job_post_id: str,
    request: EmployerDecisionRequest,
    decisions: EmployerDecisionsDependency,
) -> EmployerDecision:
    """The hiring manager approves (publishes) or rejects the rewritten post."""
    _require_known_post(job_post_id)
    return decisions.record(job_post_id, request.approved)


@router.get(
    "/employer/rewrite-filter/{job_post_id}/decision",
    response_model=EmployerDecision,
    responses={404: {"description": "Unknown job post, or no decision yet"}},
)
def read_rewrite_decision(
    job_post_id: str,
    decisions: EmployerDecisionsDependency,
) -> EmployerDecision:
    _require_known_post(job_post_id)
    decision = decisions.latest(job_post_id)
    if decision is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No hiring-manager decision recorded for {job_post_id} yet.",
        )
    return decision


def _require_known_post(job_post_id: str) -> None:
    if job_post_id not in JOB_POSTS_BY_ID:
        known = ", ".join(sorted(JOB_POSTS_BY_ID))
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"unknown job_post_id {job_post_id!r}; expected one of: {known}",
        )


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
