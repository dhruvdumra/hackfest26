import json
import logging
import re
import threading
import time
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    # httpx exports the USE_CLIENT_DEFAULT sentinel at top level but not the
    # class behind it, so the annotation needs the private path. Only needed for
    # typing — the value itself is always the public httpx.USE_CLIENT_DEFAULT.
    from httpx._client import UseClientDefault

from app.config import (
    Settings,
    resolve_genai_provider,
)
from app.mocks.genai_fixtures import (
    CREDENTIAL_THRESHOLD,
    NEEDS_PROOF_TERMS,
    SKILL_CATALOG,
    proof_request_for,
)
from app.models import (
    ExtractedSkill,
    SkillExtractionResponse,
    WorkSampleResponse,
)

logger = logging.getLogger(__name__)

_TOKEN_PATTERN = re.compile(r"[a-z0-9+#.]+")
# XSUAA's documented client-credentials lifetime. Used only when a token
# response omits expires_in or holds something unparseable, so the cache still
# has a number to work with instead of re-minting on every call.
DEFAULT_TOKEN_LIFETIME_SECONDS = 3600.0
_STOP_WORDS = frozenset(
    {
        "and",
        "the",
        "for",
        "with",
        "from",
        "that",
        "this",
        "have",
        "has",
        "was",
        "were",
        "are",
        "but",
        "not",
        "you",
        "your",
        "our",
        "into",
        "out",
        "over",
        "about",
        "been",
        "they",
        "them",
        "their",
        "then",
        "than",
        "when",
        "while",
        "where",
        "which",
        "who",
        "will",
        "would",
        "could",
        "should",
        "after",
        "before",
        "also",
        "just",
        "like",
        "some",
        "more",
        "most",
        "other",
        "such",
        "only",
        "very",
        "many",
        "much",
        "each",
        "both",
        "because",
        "during",
        "through",
        "using",
        "used",
        "years",
        "year",
        "months",
        "month",
        "back",
        "worked",
        "work",
        "experience",
        "experienced",
    }
)


def extract_skills(transcript: str, settings: Settings) -> SkillExtractionResponse:
    if settings.use_mock_genai:
        return _mock_extraction(transcript)
    try:
        return _live_extraction(transcript, settings)
    except Exception:
        logger.warning(
            "SAP Generative AI Hub skills extraction failed; serving simulated fixture",
            exc_info=True,
        )
        return _mock_extraction(transcript)


def score_work_sample(
    skill_id: str,
    submission: str,
    settings: Settings,
) -> WorkSampleResponse:
    if settings.use_mock_genai:
        return _mock_work_sample(skill_id, submission)
    try:
        return _live_work_sample(skill_id, submission, settings)
    except Exception:
        logger.warning(
            "SAP Generative AI Hub work-sample scoring failed; serving simulated fixture",
            exc_info=True,
        )
        return _mock_work_sample(skill_id, submission)


def _live_extraction(transcript: str, settings: Settings) -> SkillExtractionResponse:
    payload = _orchestration_payload(
        settings=settings,
        prompt=(
            "Extract durable, evidence-backed skills from the career transcript. "
            "Return JSON with skills (name, confidence between 0 and 1) and "
            "needs_proof as a list of skill names."
        ),
        input_text=transcript,
    )
    response = _post_orchestration(payload, settings)
    return _parse_extraction(response)


def _live_work_sample(
    skill_id: str,
    submission: str,
    settings: Settings,
) -> WorkSampleResponse:
    payload = _orchestration_payload(
        settings=settings,
        prompt=(
            "Score the candidate work sample for the named skill from 0 to 100. "
            "Return JSON with score and credential_issued (true only at or above 70)."
        ),
        input_text=f"skill_id: {skill_id}\nsubmission:\n{submission}",
    )
    response = _post_orchestration(payload, settings)
    return _parse_work_sample(response)


def _orchestration_payload(
    settings: Settings,
    prompt: str,
    input_text: str,
) -> dict[str, Any]:
    return {
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": input_text},
        ],
        "model": settings.genai_hub_model,
    }


def _post_orchestration(payload: dict[str, Any], settings: Settings) -> Any:
    return post_orchestration(payload, settings)


def post_orchestration(payload: dict[str, Any], settings: Settings) -> Any:
    """Send one chat request to whichever live provider is configured.

    Public because a second caller now shares it: the Employer Readiness filter
    rewrite in ``app/services/employer_rewrite.py`` talks to the same provider
    with the same credentials and the same timeout. Keeping one function for
    "how do we reach a model" is the point — if the auth shape or the timeout
    changes, both callers change together instead of drifting apart.

    Provider selection is ``app.config.resolve_genai_provider``. The SAP
    Generative AI Hub is the default and the intended production path; Gemini
    and any OpenAI-compatible gateway (OpenCode Zen, OpenRouter, NVIDIA NIM)
    are the fallbacks for environments where no AI Core key is obtainable — a
    BTP trial account does not carry SAP AI Core. All three return the same
    OpenAI-style envelope, so everything above this function is
    provider-agnostic. ``describe_genai_provider`` names the concrete gateway
    for logs and the preflight; no log claims SAP answered when it did not.

    SAP authentication is the two-step AI Core flow when
    ``GENAI_HUB_AUTH_URL`` is set: mint a bearer token with
    ``grant_type=client_credentials``, then send it as ``Authorization:
    Bearer``. With that variable blank the call falls back to HTTP Basic, which
    is what the Hub rejected before this change — Basic is a credential sent on
    every request, not a token, and the inference endpoint answers it with 401.

    Raises RuntimeError when the live configuration is incomplete, and
    httpx.HTTPError when a call itself fails. Callers are expected to degrade
    to a labelled fixture rather than let either propagate.
    """
    if resolve_genai_provider(settings) == "gemini":
        from app.services import gemini_client

        return gemini_client.post_generate_content(payload, settings)
    if resolve_genai_provider(settings) == "compatible":
        return _post_to_compatible(payload, settings)
    return _post_to_sap(payload, settings)


def _post_to_compatible(payload: dict[str, Any], settings: Settings) -> Any:
    """Any OpenAI-compatible gateway: OpenCode Zen, OpenRouter, NVIDIA NIM.

    All three speak POST /chat/completions with a bearer key, so this is one
    code path rather than three integrations. The response is already in the
    shape the parsers above expect; it is only normalised into the same
    envelope the SAP path returns, so nothing above this function can tell
    which gateway answered and therefore no answer is mistaken for an SAP one.
    """
    from app.services import openai_compatible

    document = openai_compatible.post_chat_completions(payload, settings)
    text = openai_compatible.extract_message_text(document)
    return _envelope_with(text)


def _envelope_with(text: str) -> dict[str, Any]:
    """Wrap model text in the envelope the shared parsers look for."""
    return {
        "results": [
            {"output": {"choices": [{"message": {"content": text}}]}},
        ]
    }


def _post_to_sap(payload: dict[str, Any], settings: Settings) -> Any:
    """The SAP Generative AI Hub request, auth and headers unchanged."""
    _require_live_configuration(settings)
    timeout = settings.genai_hub_timeout_seconds
    # Exactly one auth shape per request: a bearer token when a token endpoint
    # is configured, HTTP Basic otherwise. httpx.UseClientDefault is httpx's
    # "argument not supplied" sentinel, so the Basic path sends no auth at all
    # rather than an empty one that would override the Authorization header.
    auth: httpx.Auth | UseClientDefault = (
        httpx.USE_CLIENT_DEFAULT
        if settings.genai_hub_auth_url.strip()
        else _basic_auth(settings)
    )
    with httpx.Client(timeout=timeout) as client:
        response = client.post(
            settings.genai_hub_endpoint,
            json=payload,
            headers=_auth_headers(settings),
            auth=auth,
        )
        response.raise_for_status()
        return response.json()


def _basic_auth(settings: Settings) -> httpx.BasicAuth:
    return httpx.BasicAuth(
        settings.genai_hub_client_id,
        settings.genai_hub_client_secret.get_secret_value(),
    )


def _auth_headers(settings: Settings) -> dict[str, str]:
    """Build the request headers, including a bearer token when one is due."""
    headers = {"Content-Type": "application/json"}
    resource_group = settings.genai_hub_resource_group.strip()
    if resource_group:
        # AI Core routes a request to the deployment's resource group. Sending
        # it blank is a 403, so the header is omitted rather than emptied.
        headers["AI-Resource-Group"] = resource_group
    token = _access_token(settings)
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    return headers


# ── Token exchange ──────────────────────────────────────────────────────
#
# SAP AI Core does not take the client secret on the inference request. It takes
# a bearer token from the XSUAA token endpoint, obtained with the client
# credentials. Without this the only option is Basic auth, which the inference
# endpoint answers with 401 — so the answer to "why is AI Core not live?" was
# "the auth shape was wrong", not "we had no trial key".
#
# The token lives for `expires_in` seconds (XSUAA issues 3600). It is cached
# until shortly before it expires rather than re-minted per request, because the
# pipeline streams seven agent events and re-minting on each one would mean an
# auth round trip per event. The margin keeps a token from expiring mid-flight.

TOKEN_PATH = "/oauth/token"
_TOKEN_LOCK = threading.Lock()
_TOKEN_CACHE: dict[str, tuple[str, float]] = {}


def _access_token(settings: Settings) -> str | None:
    """Return a cached bearer token, minting one when the cache is cold or stale.

    Returns None when no token endpoint is configured, which sends the caller
    down the Basic-auth path rather than raising: a blank GENAI_HUB_AUTH_URL is
    a legitimate configuration for a deployment that does accept Basic.
    """
    auth_url = settings.genai_hub_auth_url.strip()
    if not auth_url:
        return None
    with _TOKEN_LOCK:
        cached = _TOKEN_CACHE.get(_token_cache_key(settings))
        if cached is not None:
            token, expires_at = cached
            if time.monotonic() < expires_at:
                return token
        token, expires_in = _mint_token(settings, auth_url)
        margin = settings.genai_hub_token_expiry_margin_seconds
        # A negative lifetime means the cache would consider the token stale
        # forever and re-mint on every call; clamp so at least this call reuses it.
        lifetime = max(0.0, expires_in - margin)
        _TOKEN_CACHE[_token_cache_key(settings)] = (token, time.monotonic() + lifetime)
        return token


def _mint_token(settings: Settings, auth_url: str) -> tuple[str, float]:
    """Exchange the client credentials for a bearer token and its lifetime."""
    data = {
        "grant_type": "client_credentials",
        "client_id": settings.genai_hub_client_id,
        "client_secret": settings.genai_hub_client_secret.get_secret_value(),
    }
    with httpx.Client(timeout=settings.genai_hub_timeout_seconds) as client:
        response = client.post(_token_url(auth_url), data=data)
        response.raise_for_status()
        document = response.json()
    if not isinstance(document, Mapping):
        raise RuntimeError("the GenAI Hub token endpoint did not return a JSON object")
    token = document.get("access_token")
    if not isinstance(token, str) or not token.strip():
        raise RuntimeError("the GenAI Hub token endpoint returned no access_token")
    try:
        expires_in = float(document.get("expires_in", DEFAULT_TOKEN_LIFETIME_SECONDS))
    except (TypeError, ValueError):
        # A malformed lifetime is not a reason to fail the demo: assume the
        # documented XSUAA default and cache against that.
        logger.warning("the token response held a non-numeric expires_in", exc_info=True)
        expires_in = DEFAULT_TOKEN_LIFETIME_SECONDS
    return token.strip(), expires_in


def _token_url(auth_url: str) -> str:
    """Accept either a bare XSUAA host or a full token URL.

    The SAP trial onboarding email gives the "Token URL" as a bare host, but
    documentation and copy-paste both produce the full /oauth/token form.
    Appending to a URL that already ends in the path would 404.
    """
    trimmed = auth_url.rstrip("/")
    return trimmed if trimmed.endswith(TOKEN_PATH) else f"{trimmed}{TOKEN_PATH}"


def _token_cache_key(settings: Settings) -> str:
    """Scope the cache to the credentials it was minted for.

    Two Settings objects in one process (the app, and a test) must not share a
    token, so the key carries the client id and auth URL. The secret is
    deliberately not in the key: it is never logged, and including it would put
    a credential in a dict repr that an exception could capture.
    """
    return f"{settings.genai_hub_client_id}@{settings.genai_hub_auth_url.strip()}"


def reset_token_cache() -> None:
    """Drop every cached bearer token. Used by tests and on reconfiguration."""
    with _TOKEN_LOCK:
        _TOKEN_CACHE.clear()


def proof_requests() -> dict[str, str]:
    """Canonical skill name -> the evidence a worker must supply for it."""
    return dict(NEEDS_PROOF_TERMS)


def _require_live_configuration(settings: Settings) -> None:
    missing = [
        name
        for name, value in (
            ("GENAI_HUB_ENDPOINT", settings.genai_hub_endpoint),
            ("GENAI_HUB_CLIENT_ID", settings.genai_hub_client_id),
            ("GENAI_HUB_CLIENT_SECRET", settings.genai_hub_client_secret.get_secret_value()),
            ("GENAI_HUB_MODEL", settings.genai_hub_model),
        )
        if not value.strip()
    ]
    if missing:
        raise RuntimeError(f"missing GenAI Hub configuration: {', '.join(missing)}")


def _parse_extraction(response: Any) -> SkillExtractionResponse:
    document = _extract_json_document(response)
    if document is None or not isinstance(document, Mapping):
        raise ValueError("GenAI Hub response did not contain a JSON object")
    raw_skills = document.get("skills")
    if not isinstance(raw_skills, list) or not raw_skills:
        raise ValueError("GenAI Hub response is missing a skills list")
    skills = tuple(ExtractedSkill.model_validate(entry) for entry in raw_skills)
    raw_needs_proof = document.get("needs_proof", [])
    if not isinstance(raw_needs_proof, list):
        raise ValueError("GenAI Hub response needs_proof must be a list")
    needs_proof = tuple(
        name.strip() for name in raw_needs_proof if isinstance(name, str) and name.strip()
    )
    return SkillExtractionResponse(
        skills=list(skills),
        needs_proof=list(needs_proof),
        source="live",
    )


def _parse_work_sample(response: Any) -> WorkSampleResponse:
    document = _extract_json_document(response)
    if document is None or not isinstance(document, Mapping):
        raise ValueError("GenAI Hub response did not contain a JSON object")
    raw_score = document.get("score")
    if isinstance(raw_score, bool) or not isinstance(raw_score, (int, float)):
        raise ValueError("GenAI Hub response is missing a numeric score")
    score = max(0, min(100, int(raw_score)))
    return WorkSampleResponse(
        score=score,
        credential_issued=score >= CREDENTIAL_THRESHOLD,
        source="live",
    )


def _extract_json_document(response: Any) -> Any:
    if isinstance(response, str):
        return _coerce_text_document(response)
    if isinstance(response, Mapping):
        preferred = ("message", "content", "output", "results", "data", "value", "choices")
        for key in preferred:
            nested = response.get(key)
            if nested is not None:
                document = _extract_json_document(nested)
                if document is not None:
                    return document
        for nested in response.values():
            document = _extract_json_document(nested)
            if document is not None:
                return document
    if isinstance(response, list):
        for entry in response:
            document = _extract_json_document(entry)
            if document is not None:
                return document
    if _is_skill_document(response):
        return response
    return None


def _is_skill_document(candidate: object) -> bool:
    return isinstance(candidate, Mapping) and (
        "skills" in candidate or "score" in candidate or "needs_proof" in candidate
    )


def _coerce_text_document(text: str) -> Any:
    stripped = text.strip()
    if not stripped:
        return None
    if stripped.startswith("```"):
        stripped = re.sub(r"^```[a-zA-Z]*\n?", "", stripped)
        stripped = re.sub(r"\n?```$", "", stripped)
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        document = json.loads(stripped[start : end + 1])
    except json.JSONDecodeError:
        return None
    return document if _is_skill_document(document) else None


def _mock_extraction(transcript: str) -> SkillExtractionResponse:
    tokens = _tokenize(transcript)
    skills: list[ExtractedSkill] = []
    for catalog_term, skill_name in SKILL_CATALOG:
        matching = sum(1 for token in tokens if catalog_term in token or token in catalog_term)
        if matching == 0:
            continue
        confidence = min(0.95, 0.6 + 0.05 * matching + 0.01 * (len(skill_name) % 5))
        skills.append(
            ExtractedSkill(
                name=skill_name,
                confidence=round(confidence, 2),
            )
        )
    if not skills:
        skills = [
            ExtractedSkill(name=skill_name, confidence=0.62) for _, skill_name in SKILL_CATALOG[:3]
        ]
    skills.sort(key=lambda skill: (-skill.confidence, skill.name))
    skills = skills[:8]
    needs_proof = [skill.name for skill in skills if proof_request_for(skill.name) is not None]
    if not needs_proof and skills:
        needs_proof = [skills[-1].name]
    return SkillExtractionResponse(
        skills=skills,
        needs_proof=needs_proof,
        source="simulated",
    )


def _mock_work_sample(skill_id: str, submission: str) -> WorkSampleResponse:
    token_count = len(_tokenize(submission))
    score = min(100, 45 + token_count * 4 + len(skill_id) % 7)
    return WorkSampleResponse(
        score=score,
        credential_issued=score >= CREDENTIAL_THRESHOLD,
        source="simulated",
    )


def _tokenize(text: str) -> tuple[str, ...]:
    return tuple(
        token
        for token in _TOKEN_PATTERN.findall(text.casefold())
        if len(token) > 2 and token not in _STOP_WORDS
    )
