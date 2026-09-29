"""Google Gemini as a live LLM provider, for when SAP AI Core has no key.

Why this exists
---------------
ReRoute is an SAP Hackfest entry, so SAP AI Core is the right provider. But a
BTP trial account does not carry SAP AI Core at all -- only a free-tier
(enterprise, card-backed) account does -- so on a practice sandbox the SAP
client is written correctly and can never be exercised. Google AI Studio's
free tier needs no billing account and issues a key in about a minute, which
makes "is the orchestration wiring actually right?" a question that can be
answered tonight instead of after the event.

So this is a second provider behind the same interface, not a replacement. The
SAP path is untouched and still selected whenever it is the one configured.

What is honest about this
------------------------
The response envelope is byte-identical to the SAP one on purpose: both return
OpenAI-style ``choices[0].message.content``, so ``genai_hub``'s parsers and
``_extract_json_document`` are shared and neither is provider-aware. That is
what keeps a Gemini answer from being mistaken for a SAP one in a review.

But ``source`` is NOT widened. It stays ``"live"`` when a real model ran and
``"simulated"`` when a fixture served it, and the provider is reported
separately. A judge asking "was that a real model?" gets a real answer, and a
judge asking "was that SAP?" gets a separate, equally real answer. Widening
``source`` to hide which vendor answered would be exactly the kind of
staged agreement this project exists to criticise -- see
``app/services/employer_rewrite.py``, whose whole purpose is that the
response says which of two things happened.

Free-tier caveat, measured from the published limits: the per-day request
quota is small and Google has been cutting it. A 429 mid-demo degrades to the
labelled fixture rather than failing, but it degrades on stage. Check the quota
in AI Studio before presenting.
"""

import logging
import re
from typing import Any, Final

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

#: The Generative Language API has no `/chat/completions`; the model is the
#: path segment and the operation is `:generateContent`. Kept as a constant
#: because it is the one piece of this module that is Gemini-specific, and a
#: reader who wants to confirm it has a single line to check.
GEMINI_PATH_TEMPLATE: Final[str] = "/models/{model}:generateContent"

#: Mirrors ``genai_hub._STOP_WORDS`` in spirit: strip a fenced block so the
#: shared JSON parser sees an object rather than prose. Kept local because this
#: module must not import the SAP client, or the provider boundary dissolves.
_FENCE_PATTERN: Final[str] = r"^```[a-zA-Z]*\n?|\n?```$"


def gemini_url(settings: Settings) -> str:
    """The generateContent URL for the configured model.

    The model name may already be prefixed (``models/gemini-2.5-flash``) in
    AI Studio's UI, so a leading ``models/`` is stripped before it is used to
    avoid producing ``models/models/...``, which 404s.
    """
    model = settings.gemini_model.strip().removeprefix("models/")
    return (
        f"{settings.gemini_api_base.rstrip('/')}"
        + GEMINI_PATH_TEMPLATE.format(model=model)
    )


def post_generate_content(payload: dict[str, Any], settings: Settings) -> Any:
    """Send one generateContent request and return an OpenAI-shaped envelope.

    The return value is deliberately the SAP client's shape -- ``results`` ->
    ``output`` -> ``choices`` -> ``message`` -> ``content`` -- so the caller's
    parser cannot tell the difference. Callers that care which vendor answered
    ask ``app.config.resolve_genai_provider``; they do not infer it from here.

    The API key goes in the ``x-goog-api-key`` header rather than a query
    parameter: query strings land in proxy logs and crash reports, headers do
    not.

    Raises RuntimeError when the key is missing, and httpx.HTTPError when the
    call itself fails. Callers degrade to the labelled fixture on either.
    """
    key = settings.gemini_api_key.get_secret_value().strip()
    if not key:
        raise RuntimeError("missing Gemini configuration: GEMINI_API_KEY")

    with httpx.Client(timeout=settings.genai_hub_timeout_seconds) as client:
        response = client.post(
            gemini_url(settings),
            json=_to_gemini_request(payload),
            headers={"x-goog-api-key": key, "Content-Type": "application/json"},
        )
        response.raise_for_status()
        return _to_openai_envelope(response.json())


def _to_gemini_request(payload: dict[str, Any]) -> dict[str, Any]:
    """Convert the shared chat payload into Gemini's ``contents`` shape.

    ``genai_hub`` sends ``{"messages": [{"role", "content"}...], "model": ...}``
    because that is what the SAP orchestration endpoint wants. Gemini splits
    the same conversation differently: ``system_instruction`` for the system
    turn, ``contents`` for the rest with ``user``/``model`` rather than
    ``user``/``assistant``. Any role Gemini does not know is mapped to
    ``user``, which is the documented safe fallback -- a rejected role would be
    a 400 and a failed live call, while a mislabelled role is merely slightly
    wrong in a way the model handles.

    ``generationConfig.response_mime_type`` is set to application/json. Gemini
    honours it as a strong instruction, not an enforced schema, so the parser
    still has to cope with prose -- and it does, because the parser is shared.
    """
    messages = payload.get("messages", [])
    system = [m for m in messages if m.get("role") == "system"]
    conversation = [m for m in messages if m.get("role") != "system"]
    return {
        "systemInstruction": {
            "parts": [{"text": str(message.get("content", ""))} for message in system]
        },
        "contents": [
            {
                "role": "model" if message.get("role") == "assistant" else "user",
                "parts": [{"text": str(message.get("content", ""))}],
            }
            for message in conversation
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            # Structured extraction and scoring are not creative tasks; a
            # temperature of 0 makes the demo reproducible, which matters when
            # a judge re-runs it and compares.
            "temperature": 0,
        },
    }


def _to_openai_envelope(document: Any) -> dict[str, Any]:
    """Reshape Gemini's response into the SAP client's envelope.

    Stands a negative reason up rather than raising, because the caller's
    failure policy already handles a raised error and an error raised here
    would lose the vendor's own explanation of what went wrong -- a 429 reads
    as a rate limit here, and that is worth surfacing in the log.
    """
    if not isinstance(document, dict):
        return _envelope(f"Gemini returned {type(document).__name__}, expected an object")

    error = document.get("error")
    if isinstance(error, dict):
        message = error.get("message") or "unknown Gemini error"
        return _envelope(f"Gemini error {error.get('code', '?')}: {message}")

    candidates = document.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return _envelope("Gemini returned no candidates")

    parts = (
        candidates[0]
        .get("content", {})
        .get("parts", [])
    )
    text = "".join(
        part.get("text", "")
        for part in parts
        if isinstance(part, dict)
    ).strip()
    if not text:
        finish = candidates[0].get("finishReason", "unspecified")
        return _envelope(f"Gemini returned no text content (finishReason={finish})")

    return _envelope(text)


def _envelope(content: str) -> dict[str, Any]:
    return {
        "results": [
            {"output": {"choices": [{"message": {"content": content}}]}},
        ]
    }


def strip_fence(text: str) -> str:
    """Remove a Markdown fence, for callers that pre-clean before parsing.

    The shared parser already handles fences, so this is not needed by the
    current call path. It exists because Gemini's JSON mode frequently still
    wraps output in ```json fences, and a future caller reaching for the raw
    text would otherwise re-implement the stripping a third time.
    """
    return re.sub(_FENCE_PATTERN, "", text.strip())


def settings_from_environment(**overrides: Any) -> Settings:
    """Build Settings, for the one-off CLI check in ``scripts/check_gemini.py``."""
    return Settings(**overrides)


__all__ = [
    "GEMINI_PATH_TEMPLATE",
    "gemini_url",
    "post_generate_content",
    "settings_from_environment",
    "strip_fence",
]
