"""Employer Readiness: rewrite a job post's filter from an actual audit finding.

Why this module exists
----------------------
Before it, ``POST /employer/rewrite-filter`` returned a string that was written
in advance, in ``app/mocks/employer_fixtures.py``. The fixture's "after" text
happened to name the exact remedies for the exact deltas the Ghost Twin audit
produces — regression, defect triage, a career break being acceptable — so the
demo looked like the rewrite *followed* the audit. It did not. The Employer
Readiness node never received the audit result at all, so a different finding
would have produced the same hardcoded paragraph. The agreement was staged.

This module derives the rewrite from the finding instead. Given the job post
and the audit's deltas, it asks the model to remove the wording that is actually
costing the candidate points, and the response is labelled ``live`` only when the
model really ran. ``derived_from_audit`` is carried in the payload so a reviewer
can see which of the two happened rather than inferring it from prose.

The audit itself is never delegated to a model. ``app/domain/ghost_twin.py``
stays pure Python, because a fairness verdict that cannot be reproduced is not a
verdict. This module acts on that verdict; it does not produce it.

Failure policy: every failure degrades to the bundled fixture and says
``simulated``. A model that is slow, rate-limited, or returns prose instead of
JSON must not take down the pipeline — the orchestrator's node treats this as one
more recoverable step.
"""

import json
import logging
import re
from collections.abc import Mapping, Sequence
from typing import Any, Final

from app.config import Settings
from app.mocks.employer_fixtures import (
    DISCLAIMER,
    JOB_POSTS_BY_ID,
    JobPost,
)
from app.models import GhostTwinResult, GhostTwinVariant

logger = logging.getLogger(__name__)

#: Attributes are described in the prompt in the candidate's terms, not the
#: engine's. "career_gap" is an implementation name; "an 18-month career break"
#: is what an employer wrote and what a reader recognises.
_ATTRIBUTE_PHRASES: Final[dict[str, str]] = {
    "career_gap": "a candidate's employment gap",
    "gender": "candidates' gender",
    "age": "candidates' age",
    "college_tier": "which college a candidate attended",
    "city": "which city a candidate lives in",
}

#: A delta at or below this is not worth rewriting anything for. The audit
#: itself uses a configured threshold; this is a second, lower bar so a rewrite
#: is only offered when there is a finding to act on.
MIN_ACTIONABLE_DELTA: Final[int] = 1

#: Upper bound on what the model may return, so one prompt cannot make the
#: session store carry an unbounded paragraph.
_MAX_REWRITE_CHARS: Final[int] = 2_000
_MAX_REMOVED_CRITERIA: Final[int] = 8

_JSON_START = re.compile(r"\{")
_TOKEN_PATTERN = re.compile(r"[a-z0-9+#.]+")
_ATTRIBUTE_TOKENS = frozenset(_ATTRIBUTE_PHRASES)


class EmployerRewriteUnavailableError(RuntimeError):
    """Raised when no job post is bundled under the requested id."""


def rewrite_filter(
    job_post_id: str,
    settings: Settings,
    audit_result: GhostTwinResult | None = None,
) -> dict[str, Any]:
    """Return the rewrite for one job post, derived from ``audit_result``.

    The returned mapping is the response body for
    ``EmployerFilterRewriteResponse``. ``source`` is ``live`` only when the model
    produced the rewrite; otherwise it is the bundled fixture's ``simulated``
    label, and ``derived_from_audit`` is False so the two are never confused.
    """
    post = JOB_POSTS_BY_ID.get(job_post_id)
    if post is None:
        known = ", ".join(sorted(JOB_POSTS_BY_ID))
        raise EmployerRewriteUnavailableError(
            f"unknown job_post_id {job_post_id!r}; expected one of: {known}"
        )

    findings = _actionable_findings(audit_result)

    if settings.use_mock_genai or not findings:
        return _fixture_rewrite(post, audit_result, findings)

    try:
        return _live_rewrite(post, findings, settings)
    except Exception:
        logger.warning(
            "GenAI Hub filter rewrite failed for %s; serving the bundled fixture",
            job_post_id,
            exc_info=True,
        )
        return _fixture_rewrite(post, audit_result, findings)


# ── The findings the rewrite is derived from ──────────────────────────────


def _actionable_findings(audit_result: GhostTwinResult | None) -> list[GhostTwinVariant]:
    """The audit's non-zero deltas, worst first, with the neutral ones dropped.

    Ordering matters: the model is shown the largest penalty first, and the
    ``removed_criteria`` it returns are read as a list because the employer acts
    on them in order. A delta of zero is evidence the attribute is *not*
    costing the candidate, and including those would invite the rewrite to
    remove wording that the audit just cleared.
    """
    if audit_result is None:
        return []
    twins = audit_result.twins if isinstance(audit_result.twins, Sequence) else []
    flagged = [twin for twin in twins if abs(twin.delta) >= MIN_ACTIONABLE_DELTA]
    # Worst penalty first; a tie keeps the engine's own order, which is the
    # attribute order the audit reported.
    return sorted(flagged, key=lambda twin: -abs(twin.delta))


def _findings_phrase(findings: Sequence[GhostTwinVariant]) -> str:
    if not findings:
        return "no attribute was penalised by this screen"
    return "; ".join(
        f"{_ATTRIBUTE_PHRASES.get(twin.attribute, twin.attribute)} "
        f"changed the score by {twin.delta:+d} points"
        for twin in findings
    )


# ── The live path ────────────────────────────────────────────────────────


def _live_rewrite(
    post: JobPost,
    findings: Sequence[GhostTwinVariant],
    settings: Settings,
) -> dict[str, Any]:
    payload = _orchestration_payload(post, findings, settings)
    document = _coerce_rewrite(_post_orchestration(payload, settings))

    after = _read_text(document, "filter_text_after")
    if not after:
        raise ValueError("the rewrite response carried no filter_text_after")
    reason = _read_text(document, "rewrite_reason") or _default_reason(findings)
    removed = _read_removed(document)

    return {
        "job_post_id": post["post_id"],
        "role": post["role"],
        "city": post["city"],
        "filter_text_before": post["filter_text_before"],
        "filter_text_after": after[:_MAX_REWRITE_CHARS],
        "restrictive_phrase": post["restrictive_phrase"],
        "removed_criteria": removed or list(post["removed_criteria"]),
        "hidden_talent_count": post["hidden_talent_count"],
        "rewrite_reason": reason,
        "source": "live",
        "disclaimer": DISCLAIMER,
        "audit_attributes": [twin.attribute for twin in findings],
        "derived_from_audit": True,
    }


def _orchestration_payload(
    post: JobPost,
    findings: Sequence[GhostTwinVariant],
    settings: Settings,
) -> dict[str, Any]:
    """The instruction sent to the model.

    Deliberately narrow. The model is asked to remove the wording responsible
    for a specific, measured penalty — not to judge the post, and not to decide
    whether the penalty is real. The audit already decided that; a second opinion
    from a language model would only add a source of disagreement to a finding
    that is meant to be reproducible.
    """
    prompt = (
        "You are helping an employer remove discriminatory wording from a job "
        "post.\n"
        "A screening model was audited by changing one candidate attribute at a "
        "time and re-scoring. These attributes measurably changed the score:\n"
        f"{_findings_phrase(findings)}\n"
        "Rewrite the job post to remove the wording responsible for those "
        "penalties and replace pedigree, age, gender, college tier and city "
        "requirements with evidence of skill.\n"
        "Do not add requirements. Do not mention the audit. Keep the role and "
        "the location.\n"
        'Return JSON only: {"filter_text_after": str, "removed_criteria": '
        '[str], "rewrite_reason": str}'
    )
    return {
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": post["filter_text_before"]},
        ],
        "model": settings.genai_hub_model,
    }


def _post_orchestration(payload: dict[str, Any], settings: Settings) -> Any:
    from app.services.genai_hub import post_orchestration

    # The Hub client already owns the transport, the credential check and the
    # timeout, so the rewrite reuses it rather than reimplementing an HTTP call
    # beside it. One place owns "how do we talk to the Hub".
    return post_orchestration(payload, settings)


# ── Response parsing ─────────────────────────────────────────────────────


def _coerce_rewrite(response: Any) -> Mapping[str, Any]:
    """Pull the rewrite object out of whatever shape the Hub returned.

    Orchestration endpoints wrap the model's answer differently depending on the
    deployment — sometimes a `message.content` string, sometimes a nested list of
    content blocks, sometimes the object itself. Rather than encode one vendor's
    envelope, this walks the response for the first mapping that actually looks
    like a rewrite, and tolerates a fenced or prose-wrapped JSON body.
    """
    document = _find_rewrite(response)
    if document is None:
        raise ValueError("the rewrite response did not contain a JSON object")
    return document


#: How deep the envelope walker will descend before giving up.
#:
#: Measured, not guessed. A real orchestration response nests at least
#: ``results[] → output → choices[] → message → content``, which is 7 hops to
#: the string that holds the JSON. The first version of this walker stopped at 6
#: and so silently failed on a well-formed live response — it only looked like a
#: test-harness problem because the fixture path never reaches it. Measured
#: against the documented envelope, plus headroom for a vendor wrapper.
_ENVELOPE_MAX_DEPTH = 12


def _find_rewrite(candidate: Any, depth: int = 0) -> Mapping[str, Any] | None:
    if depth > _ENVELOPE_MAX_DEPTH:
        return None
    if isinstance(candidate, str):
        return _parse_embedded_json(candidate)
    if isinstance(candidate, Mapping):
        if _looks_like_rewrite(candidate):
            return candidate
        for key in ("message", "content", "output", "results", "data", "value", "choices"):
            nested = candidate.get(key)
            if nested is not None:
                found = _find_rewrite(nested, depth + 1)
                if found is not None:
                    return found
        for nested in candidate.values():
            found = _find_rewrite(nested, depth + 1)
            if found is not None:
                return found
    elif isinstance(candidate, (list, tuple)):
        for entry in candidate:
            found = _find_rewrite(entry, depth + 1)
            if found is not None:
                return found
    return None


def _looks_like_rewrite(candidate: Mapping[str, Any]) -> bool:
    return "filter_text_after" in candidate


def _parse_embedded_json(text: str) -> Mapping[str, Any] | None:
    stripped = text.strip()
    if not stripped:
        return None
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[a-zA-Z]*\n?", "", stripped)
        stripped = re.sub(r"\n?```$", "", stripped)
    start = _JSON_START.search(stripped)
    end = stripped.rfind("}")
    if start is None or end <= start.start():
        return None
    try:
        document = json.loads(stripped[start.start() : end + 1])
    except json.JSONDecodeError:
        return None
    if isinstance(document, Mapping) and _looks_like_rewrite(document):
        return document
    return None


def _read_text(document: Mapping[str, Any], key: str) -> str:
    value = document.get(key)
    if not isinstance(value, str):
        return ""
    return value.strip()


def _read_removed(document: Mapping[str, Any]) -> list[str]:
    value = document.get("removed_criteria")
    if not isinstance(value, list):
        return []
    criteria = [entry.strip() for entry in value if isinstance(entry, str) and entry.strip()]
    return criteria[:_MAX_REMOVED_CRITERIA]


# ── The fixture path ─────────────────────────────────────────────────────


def _fixture_rewrite(
    post: JobPost,
    audit_result: GhostTwinResult | None,
    findings: Sequence[GhostTwinVariant],
) -> dict[str, Any]:
    """The bundled rewrite, labelled ``simulated`` and never claiming derivation.

    ``derived_from_audit`` stays False even when an audit was supplied, because
    the text did not come from it. Reporting the attributes that motivated the
    request is honest; claiming the response was produced from them is not.
    """
    return {
        "job_post_id": post["post_id"],
        "role": post["role"],
        "city": post["city"],
        "filter_text_before": post["filter_text_before"],
        "filter_text_after": post["filter_text_after"],
        "restrictive_phrase": post["restrictive_phrase"],
        "removed_criteria": list(post["removed_criteria"]),
        "hidden_talent_count": post["hidden_talent_count"],
        "rewrite_reason": post["rewrite_reason"],
        "source": "simulated",
        "disclaimer": DISCLAIMER,
        "audit_attributes": [twin.attribute for twin in findings],
        "derived_from_audit": False,
    }


def _default_reason(findings: Sequence[GhostTwinVariant]) -> str:
    attributes = ", ".join(twin.attribute.replace("_", " ") for twin in findings)
    return f"Wording penalising {attributes} replaced with skill evidence."


def described_attributes() -> list[str]:
    """The attributes the prompt knows how to describe, for API documentation."""
    return sorted(_ATTRIBUTE_TOKENS)
