"""Any OpenAI-compatible gateway: one code path for three services.

OpenCode Zen, OpenRouter and NVIDIA NIM are not three integrations — they are
one wire format with three different base URLs. These tests therefore assert
the shared contract, and then assert the three provider-specific details that
actually differ:

  * the model is the gateway's, never SAP's deployment name
  * the key is a bearer token in a header, never a query parameter
  * OpenRouter gets its attribution headers; the others do not
  * an error body becomes readable text, so a 429 or a bad model id reaches
    the log with the vendor's own wording
  * every failure degrades to the labelled fixture, and the provider is named

And the honesty test that matters most: a gateway answer is never dressed as
an SAP one, and `source` keeps its existing meaning.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.config import (
    Settings,
    describe_genai_provider,
    genai_is_configured,
    resolve_genai_provider,
)
from app.services import genai_hub as genai_hub_module
from app.services import openai_compatible

GATEWAY_KEY = "test-gateway-key-not-real"
ZEN = "https://opencode.ai/zen/v1"
OPENROUTER = "https://openrouter.ai/api/v1"
NVIDIA = "https://integrate.api.nvidia.com/v1"

GATEWAYS = [
    pytest.param(ZEN, "space-bunny-free", id="opencode-zen"),
    pytest.param(OPENROUTER, "meta-llama/llama-3.3-70b-instruct:free", id="openrouter"),
    pytest.param(NVIDIA, "meta/llama-3.1-70b-instruct", id="nvidia-nim"),
]

EXTRACTION = '{"skills": [{"name": "Regression testing", "confidence": 0.9}], "needs_proof": []}'


def gateway_settings(base_url: str, model: str, **overrides: Any) -> Settings:
    defaults: dict[str, Any] = {
        "use_mock_genai": False,
        "genai_provider": "compatible",
        "llm_base_url": base_url,
        "llm_api_key": GATEWAY_KEY,
        "llm_model": model,
    }
    defaults.update(overrides)
    return Settings(**defaults)


def chat_body(content: str) -> dict[str, Any]:
    return {"choices": [{"message": {"content": content}, "finish_reason": "stop"}]}


class RecordingTransport(httpx.BaseTransport):
    def __init__(self, body: dict[str, Any] | None = None, status: int = 200) -> None:
        self.requests: list[httpx.Request] = []
        self._body = body if body is not None else chat_body(EXTRACTION)
        self._status = status

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(self._status, json=self._body)


def install(monkeypatch: pytest.MonkeyPatch, transport: RecordingTransport) -> RecordingTransport:
    original = httpx.Client

    def patched(*args: Any, **kwargs: Any) -> httpx.Client:
        kwargs["transport"] = transport
        return original(*args, **kwargs)

    monkeypatch.setattr(httpx, "Client", patched)
    return transport


# ── One path, three services ────────────────────────────────────────────


@pytest.mark.parametrize(("base_url", "model"), GATEWAYS)
def test_all_three_gateways_are_driven_identically(
    monkeypatch: pytest.MonkeyPatch,
    base_url: str,
    model: str,
) -> None:
    """Three services, one integration. If these three ever diverge, the
    abstraction has leaked and one provider is silently broken."""
    transport = install(monkeypatch, RecordingTransport())

    genai_hub_module.extract_skills(
        "I wrote regression tests in Jira.", gateway_settings(base_url, model)
    )

    sent = transport.requests[0]
    assert sent.url.path.endswith("/chat/completions")
    assert sent.headers["Authorization"] == f"Bearer {GATEWAY_KEY}"
    body = json.loads(sent.read())
    assert body["model"] == model
    assert body["messages"][0]["role"] == "system"


@pytest.mark.parametrize(("base_url", "model"), GATEWAYS)
def test_every_gateway_yields_a_live_labelled_extraction(
    monkeypatch: pytest.MonkeyPatch,
    base_url: str,
    model: str,
) -> None:
    install(monkeypatch, RecordingTransport())

    response = genai_hub_module.extract_skills(
        "I wrote regression tests in Jira.", gateway_settings(base_url, model)
    )

    assert response.source == "live"
    assert response.skills[0].name == "Regression testing"


@pytest.mark.parametrize(("base_url", "model"), GATEWAYS)
def test_a_gateway_answer_never_leaks_saps_deployment_name(
    monkeypatch: pytest.MonkeyPatch,
    base_url: str,
    model: str,
) -> None:
    """The shared payload carries SAP's model; the gateway needs its own."""
    transport = install(monkeypatch, RecordingTransport())

    genai_hub_module.extract_skills(
        "I wrote regression tests in Jira.",
        gateway_settings(base_url, model, genai_hub_model="sap-deployment-name"),
    )

    body = json.loads(transport.requests[0].read())
    assert body["model"] == model
    assert "sap-deployment-name" not in json.dumps(body)


# ── Provider selection ──────────────────────────────────────────────────


def test_auto_takes_the_gateway_when_only_it_is_configured() -> None:
    settings = Settings(
        use_mock_genai=False,
        llm_base_url=ZEN,
        llm_api_key=SecretStr(GATEWAY_KEY),
        llm_model="space-bunny-free",
    )
    assert resolve_genai_provider(settings) == "compatible"


def test_gemini_still_wins_over_the_gateway_when_both_are_configured() -> None:
    settings = Settings(
        use_mock_genai=False,
        gemini_api_key=SecretStr("gemini-key"),
        llm_base_url=ZEN,
        llm_api_key=SecretStr(GATEWAY_KEY),
        llm_model="space-bunny-free",
    )
    assert resolve_genai_provider(settings) == "gemini"


def test_a_half_configured_gateway_is_not_treated_as_configured() -> None:
    """A key with no base URL has nowhere to go, and a base URL with no key 401s."""
    no_key = Settings(use_mock_genai=False, llm_base_url=ZEN, llm_model="space-bunny-free")
    no_model = Settings(
        use_mock_genai=False, llm_base_url=ZEN, llm_api_key=SecretStr(GATEWAY_KEY)
    )
    assert genai_is_configured(no_key) is False
    assert genai_is_configured(no_model) is False
    assert genai_is_configured(gateway_settings(ZEN, "space-bunny-free")) is True


@pytest.mark.parametrize(
    ("base_url", "expected"),
    [
        (ZEN, "opencode-zen"),
        (OPENROUTER, "openrouter"),
        (NVIDIA, "nvidia-nim"),
        ("https://llm.internal.test/v1", "compatible:llm.internal.test"),
    ],
)
def test_the_preflight_names_the_concrete_gateway(
    base_url: str,
    expected: str,
) -> None:
    """"compatible" alone would not tell an operator which service they are on."""
    assert describe_genai_provider(gateway_settings(base_url, "m")) == expected


# ── Provider-specific details ───────────────────────────────────────────


def test_openrouter_gets_attribution_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Two `install` calls in one test would nest the patched Client and the
    second transport would never see a request, so each gateway is its own
    test."""
    transport = install(monkeypatch, RecordingTransport())

    genai_hub_module.extract_skills("x", gateway_settings(OPENROUTER, "m"))

    headers = transport.requests[0].headers
    assert headers["HTTP-Referer"] == "https://github.com/mevarx/hackfest26"
    assert "X-Title" in headers


def test_other_gateways_get_no_openrouter_attribution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = install(monkeypatch, RecordingTransport())

    genai_hub_module.extract_skills("x", gateway_settings(ZEN, "space-bunny-free"))

    assert "HTTP-Referer" not in transport.requests[0].headers


def test_the_key_never_appears_in_the_query_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = install(monkeypatch, RecordingTransport())

    genai_hub_module.extract_skills("x", gateway_settings(ZEN, "space-bunny-free"))

    assert GATEWAY_KEY not in str(transport.requests[0].url)


def test_a_trailing_slash_on_the_base_url_does_not_double_up() -> None:
    assert openai_compatible.chat_completions_url(
        gateway_settings("https://opencode.ai/zen/v1/", "m")
    ) == "https://opencode.ai/zen/v1/chat/completions"


def test_the_request_is_deterministic(monkeypatch: pytest.MonkeyPatch) -> None:
    """A judge who re-runs the demo should get the same answer.

    Asserted on the body actually sent, so this cannot pass while the client
    sends something else.
    """
    transport = install(monkeypatch, RecordingTransport())

    openai_compatible.post_chat_completions(
        {"messages": [{"role": "system", "content": "Extract skills."}]}, gateway_settings(ZEN, "m")
    )

    body = json.loads(transport.requests[0].read())
    assert body["temperature"] == 0


# ── Response reading ────────────────────────────────────────────────────


def test_a_gateway_error_becomes_readable_text() -> None:
    """A 429 must reach the log with the vendor's wording, not as 'no content'."""
    text = openai_compatible.extract_message_text(
        {
            "error": {
                "code": 429,
                "message": "Rate limit exceeded",
                "metadata": {"provider_code": "429"},
            }
        }
    )
    assert "429" in text
    assert "Rate limit exceeded" in text


def test_a_safety_refusal_names_the_finish_reason() -> None:
    """The model answered and declined — a different problem from a 429."""
    text = openai_compatible.extract_message_text(
        {"choices": [{"message": {"content": None}, "finish_reason": "content_filter"}]}
    )
    assert "content_filter" in text


def test_a_non_openai_error_envelope_is_still_readable() -> None:
    """Measured against NVIDIA NIM with a bad key: HTTP 410, and the body is
    {"type","title","status","detail"} with no `error` key. Reading that as
    "no choices" would name neither the status nor the reason."""
    text = openai_compatible.extract_message_text(
        {
            "type": "https://api.nvidia.com/ProblemDetail",
            "title": "Gone",
            "status": 410,
            "detail": "The supplied API key is invalid.",
        }
    )
    assert "410" in text
    assert "The supplied API key is invalid" in text
    assert "no choices" not in text


def test_content_as_a_list_of_parts_is_joined() -> None:
    text = openai_compatible.extract_message_text(
        {"choices": [{"message": {"content": [{"type": "text", "text": "hello "},
                                           {"type": "text", "text": "world"}]}}]}
    )
    assert text == "hello world"


@pytest.mark.parametrize(
    "document",
    [
        {"choices": []},
        {"choices": "nope"},
        {"choices": [{"message": "not-an-object"}]},
        {"error": "flat string error"},
        "not-a-dict",
    ],
    ids=["no-choices", "wrong-type", "bad-message", "flat-error", "not-a-dict"],
)
def test_a_malformed_gateway_response_degrades(document: Any) -> None:
    text = openai_compatible.extract_message_text(document)
    # A string that is not a JSON object: the shared parser must not accept it.
    with pytest.raises(ValueError):
        genai_hub_module._parse_extraction({"results": [{"output": {"choices": [
            {"message": {"content": text}}]}}]})


# ── Failure policy ──────────────────────────────────────────────────────


def test_a_missing_key_degrades_rather_than_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = install(monkeypatch, RecordingTransport())
    settings = gateway_settings(ZEN, "space-bunny-free", llm_api_key="")

    response = genai_hub_module.extract_skills("I wrote regression tests.", settings)

    assert response.source == "simulated"
    assert not transport.requests


def test_a_rejected_key_degrades_to_the_labelled_fixture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install(
        monkeypatch,
        RecordingTransport({"error": {"code": 401, "message": "No auth credentials"}}, 401),
    )

    response = genai_hub_module.extract_skills(
        "I wrote regression tests.", gateway_settings(ZEN, "not-a-real-key")
    )

    assert response.source == "simulated"


def test_a_work_sample_through_a_gateway_is_labelled_live(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install(monkeypatch, RecordingTransport(chat_body('{"score": 88}')))

    response = genai_hub_module.score_work_sample(
        "Regression testing", "A submission.", gateway_settings(ZEN, "space-bunny-free")
    )

    assert response.source == "live"
    assert response.score == 88


def test_mock_mode_never_calls_a_gateway(monkeypatch: pytest.MonkeyPatch) -> None:
    def explode(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("mock mode must not touch the network")

    monkeypatch.setattr(openai_compatible, "post_chat_completions", explode)

    response = genai_hub_module.extract_skills(
        "x", gateway_settings(ZEN, "space-bunny-free", use_mock_genai=True)
    )

    assert response.source == "simulated"


# ── The SAP and Gemini paths are still reachable ────────────────────────


def test_the_sap_path_is_still_chosen_when_it_is_the_one_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[Any] = []

    def record_call(payload: Any, _settings: Any) -> dict[str, Any]:
        calls.append(payload)
        return {"results": []}

    monkeypatch.setattr(genai_hub_module, "_post_to_sap", record_call)
    genai_hub_module.post_orchestration(
        {"messages": []},
        Settings(
            use_mock_genai=False,
            genai_provider="sap",
            genai_hub_endpoint="https://hub.example.test",
            genai_hub_client_id="c",
            genai_hub_client_secret=SecretStr("s"),
            genai_hub_model="m",
        ),
    )

    assert calls == [{"messages": []}]
