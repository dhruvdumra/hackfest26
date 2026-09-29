"""Any OpenAI-compatible ``/v1/chat/completions`` gateway, as one provider.

Why one client for three services
---------------------------------
OpenCode Zen, OpenRouter and NVIDIA NIM are not three integrations. All three
expose the same wire format:

    POST {base}/chat/completions
    Authorization: Bearer <key>
    {"model": "<id>", "messages": [{"role", "content"}], ...}
    -> {"choices": [{"message": {"content": "..."}}]}

So the only thing that differs between them is two strings: the base URL and
the model id. Writing three clients would be three places for the same bug.

    OpenCode Zen   https://opencode.ai/zen/v1              free models
    OpenRouter     https://openrouter.ai/api/v1            ":free" model suffix
    NVIDIA NIM     https://integrate.api.nvidia.com/v1     ~1000 credits, no card

This is the pragmatic path for an SAP Hackfest entry: the intended provider is
SAP Generative AI Hub, but a BTP trial account does not carry SAP AI Core, so
the SAP client can be written correctly and never exercised. A key from any of
these makes "is the orchestration wiring right?" a question with an answer
tonight.

What is honest about it
-----------------------
Nothing here claims to be SAP. ``app.config.describe_genai_provider`` names the
concrete gateway in every log and in the preflight, and ``source`` keeps its
existing meaning: ``live`` is a real model, ``simulated`` is the bundled
fixture. A judge asking which vendor answered gets a real answer.

The one provider-specific wrinkle worth knowing: OpenRouter's free tier
requires the ``:free`` suffix on the model id (``...:free``), and omitting it
bills real credits. That is a configuration value, not code, and the preflight
makes a wrong choice visible before the demo rather than after.
"""

import logging
from typing import Any, Final

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)

CHAT_COMPLETIONS_PATH: Final[str] = "/chat/completions"

#: Providers that want the caller identified. OpenRouter uses it for its
#: dashboard and for abuse attribution; neither requires it, so it is sent only
#: where it is known to be useful rather than to every gateway.
_HTTP_REFERER = "https://github.com/mevarx/hackfest26"
_APP_TITLE = "ReRoute (SAP Hackfest 2026)"


def chat_completions_url(settings: Settings) -> str:
    """The full chat-completions URL for the configured gateway.

    The base is expected to end at the version segment (``.../v1``), which is
    how all three document it. A trailing slash is stripped so a copied value
    does not produce a doubled separator.
    """
    return f"{settings.llm_base_url.rstrip('/')}{CHAT_COMPLETIONS_PATH}"


def post_chat_completions(payload: dict[str, Any], settings: Settings) -> Any:
    """Send one chat request to the gateway and return the shared envelope.

    The payload arrives in the shape ``genai_hub`` already uses, so it is passed
    through almost unchanged. The only edit is the model: the shared payload
    carries SAP's deployment name, and the gateway needs its own id.

    Raises RuntimeError when the key or model is missing, and httpx.HTTPError
    when the call itself fails. Callers degrade to the labelled fixture on
    either, which is what makes a 429 mid-demo a non-event.
    """
    key = settings.llm_api_key.get_secret_value().strip()
    model = settings.llm_model.strip()
    missing = [
        name
        for name, value in (
            ("LLM_API_KEY", key),
            ("LLM_MODEL", model),
            ("LLM_BASE_URL", settings.llm_base_url.strip()),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(f"missing OpenAI-compatible configuration: {', '.join(missing)}")

    body = {**payload, "model": model}
    # Structured extraction and scoring are not creative tasks. A fixed
    # temperature keeps a re-run reproducible, which matters when a judge
    # repeats the demo and compares.
    body.setdefault("temperature", 0)

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if _is_openrouter(settings):
        # OpenRouter attributes traffic with these and shows it on a dashboard.
        # Harmless elsewhere, so they are sent only to the gateway that uses them.
        headers["HTTP-Referer"] = _HTTP_REFERER
        headers["X-Title"] = _APP_TITLE

    with httpx.Client(timeout=settings.genai_hub_timeout_seconds) as client:
        response = client.post(chat_completions_url(settings), json=body, headers=headers)
        response.raise_for_status()
        return response.json()


def _is_openrouter(settings: Settings) -> bool:
    return "openrouter.ai" in settings.llm_base_url


def extract_message_text(document: Any) -> str:
    """Pull the assistant text out of a chat-completions response.

    Returns a string that may be an error description rather than model output.
    That is deliberate: the shared parser in ``genai_hub`` looks for a JSON
    object, fails, and the caller degrades to the labelled fixture — while the
    vendor's own words reach the log, which is what tells an operator whether
    the key, the quota or the model id is the problem.
    """
    if not isinstance(document, dict):
        return f"the gateway returned {type(document).__name__}, expected an object"

    error = document.get("error")
    if isinstance(error, dict):
        message = error.get("message") or "unknown gateway error"
        code = error.get("code", "?")
        metadata = error.get("metadata")
        detail = ""
        if isinstance(metadata, dict) and metadata.get("provider_code") is not None:
            detail = f" (upstream code {metadata['provider_code']})"
        return f"gateway error {code}: {message}{detail}"
    if isinstance(error, str):
        return f"gateway error: {error}"

    # Not every rejection uses the OpenAI `error` envelope. Measured against
    # NVIDIA NIM with a bad key: HTTP 410 with a body shaped
    # {"type", "title", "status", "detail"} and no `error` key at all. Without
    # this branch that surfaces as "returned no choices", which names neither
    # the status nor the reason and sends an operator looking in the wrong
    # place.
    detail_text = document.get("detail")
    if isinstance(detail_text, str) and detail_text.strip():
        status: Any = document.get("status") or document.get("code") or "?"
        return f"gateway error {status}: {detail_text.strip()}"

    choices = document.get("choices")
    if not isinstance(choices, list) or not choices:
        return "the gateway returned no choices"

    first = choices[0]
    if not isinstance(first, dict):
        return "the gateway returned a malformed choice"

    # A refusal or a filtered response carries a finish_reason and no content.
    # Saying so is more useful than "no content", because it tells an operator
    # the model answered and declined, which is a different problem from a 429.
    finish = first.get("finish_reason")
    message = first.get("message")
    if not isinstance(message, dict):
        return f"the gateway returned no message (finish_reason={finish})"

    text = message.get("content")
    if isinstance(text, str) and text.strip():
        return text.strip()
    if isinstance(text, list):
        # Some gateways return content as a list of {type, text} parts.
        joined = "".join(
            part.get("text", "")
            for part in text
            if isinstance(part, dict)
        ).strip()
        if joined:
            return joined
    return f"the gateway returned no content (finish_reason={finish})"
