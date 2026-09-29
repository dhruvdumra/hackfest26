"""Google Gemini as a live provider, and the boundary it shares with SAP.

The point of these tests is not that Gemini is reachable. It is that adding a
second provider did not change the *contract*: the same prompt goes out, the
same envelope comes back, the same parser reads it, and a Gemini answer is
never dressed as a SAP one.

  * "auto" picks Gemini when a key exists and SAP when one does not
  * an explicit provider is honoured even when unconfigured, so a typo
    surfaces as a missing-config error rather than silently switching vendors
  * the request is reshaped into Gemini's contents/systemInstruction split
  * the response is reshaped back into the SAP envelope, byte for byte
  * every failure still degrades to the labelled fixture

No network, no key, no sleeping -- the same fake-transport style as
tests/test_genai_hub_auth.py.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.config import Settings, genai_is_configured, resolve_genai_provider
from app.services import gemini_client
from app.services import genai_hub as genai_hub_module

GEMINI_KEY = "test-key-not-a-real-credential"
EXTRACTION = {"skills": [{"name": "Regression testing", "confidence": 0.9}], "needs_proof": []}


def gemini_settings(**overrides: Any) -> Settings:
    defaults: dict[str, Any] = {
        "use_mock_genai": False,
        "gemini_api_key": GEMINI_KEY,
        "gemini_model": "gemini-2.5-flash",
    }
    defaults.update(overrides)
    return Settings(**defaults)


def gemini_body(text: str) -> dict[str, Any]:
    """A generateContent response carrying `text` as the model's answer."""
    return {
        "candidates": [
            {"content": {"parts": [{"text": text}]}, "finishReason": "STOP"},
        ]
    }


class RecordingTransport(httpx.BaseTransport):
    """Captures outbound requests and replies from a canned generateContent."""

    def __init__(self, body: dict[str, Any] | None = None, status: int = 200) -> None:
        self.requests: list[httpx.Request] = []
        self._body = body if body is not None else gemini_body('{"skills": [], "needs_proof": []}')
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


# ── Provider selection ──────────────────────────────────────────────────


def test_auto_prefers_gemini_when_a_key_is_present() -> None:
    assert resolve_genai_provider(gemini_settings()) == "gemini"


def test_auto_falls_back_to_sap_without_a_gemini_key() -> None:
    assert resolve_genai_provider(Settings(use_mock_genai=False)) == "sap"


def test_an_explicit_provider_is_honoured_even_when_unconfigured() -> None:
    """A typo must surface as missing config, not as a silent vendor switch."""
    settings = Settings(use_mock_genai=False, genai_provider="gemini")
    assert resolve_genai_provider(settings) == "gemini"
    assert genai_is_configured(settings) is False


def test_auto_is_never_reported_as_configured_without_a_key() -> None:
    assert genai_is_configured(Settings(use_mock_genai=False)) is False
    assert genai_is_configured(gemini_settings()) is True


# ── Request shape ───────────────────────────────────────────────────────


def test_the_url_is_the_model_path_not_a_deployment() -> None:
    settings = gemini_settings()
    assert gemini_client.gemini_url(settings).endswith(
        "/v1beta/models/gemini-2.5-flash:generateContent"
    )


def test_a_models_prefixed_model_name_is_not_doubled() -> None:
    """AI Studio's UI shows `models/gemini-...`; pasting that must not 404."""
    settings = gemini_settings(gemini_model="models/gemini-2.5-flash")
    url = gemini_client.gemini_url(settings)
    assert "models/models/" not in url
    assert url.endswith("/models/gemini-2.5-flash:generateContent")


def test_the_system_turn_is_split_out_and_the_rest_become_contents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = install(monkeypatch, RecordingTransport())

    genai_hub_module.post_orchestration(
        {
            "messages": [
                {"role": "system", "content": "Extract skills."},
                {"role": "user", "content": "Six years of manual testing."},
            ],
            "model": "ignored",
        },
        gemini_settings(),
    )

    sent = transport.requests[0]
    assert sent.url.path == "/v1beta/models/gemini-2.5-flash:generateContent"
    body = sent.read().decode()
    assert "systemInstruction" in body
    assert '"role": "user"' in body or '"role":"user"' in body
    # The shared payload's `model` is the SAP deployment name and must not leak
    # into a Gemini request, where the model is the URL.
    assert "ignored" not in body


def test_an_assistant_turn_becomes_gemini_model_role() -> None:
    converted = gemini_client._to_gemini_request(
        {
            "messages": [
                {"role": "system", "content": "sys"},
                {"role": "assistant", "content": "prior"},
                {"role": "user", "content": "next"},
            ]
        }
    )
    roles = [entry["role"] for entry in converted["contents"]]
    assert roles == ["model", "user"]


def test_the_api_key_travels_in_a_header_not_the_query_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A key in a query string lands in proxy logs and crash reports."""
    transport = install(monkeypatch, RecordingTransport())

    genai_hub_module.post_orchestration({"messages": []}, gemini_settings())

    sent = transport.requests[0]
    assert sent.headers["x-goog-api-key"] == GEMINI_KEY
    assert GEMINI_KEY not in str(sent.url)
    assert "key=" not in str(sent.url)


def test_json_mode_and_zero_temperature_are_requested() -> None:
    converted = gemini_client._to_gemini_request({"messages": []})
    assert converted["generationConfig"]["responseMimeType"] == "application/json"
    assert converted["generationConfig"]["temperature"] == 0


# ── Response shape ──────────────────────────────────────────────────────


def test_a_gemini_response_comes_back_in_the_sap_envelope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install(monkeypatch, RecordingTransport(gemini_body("hello")))

    envelope = genai_hub_module.post_orchestration({"messages": []}, gemini_settings())

    # Byte-identical to what _post_to_sap returns, so every parser above this
    # point is provider-agnostic.
    assert envelope == {
        "results": [{"output": {"choices": [{"message": {"content": "hello"}}]}}]
    }


def test_a_gemini_extraction_is_labelled_live(monkeypatch: pytest.MonkeyPatch) -> None:
    install(
        monkeypatch,
        RecordingTransport(
            gemini_body(
                '{"skills": [{"name": "Regression testing", "confidence": 0.9}],'
                ' "needs_proof": []}'
            )
        ),
    )

    response = genai_hub_module.extract_skills(
        "I wrote regression tests in Jira for six years.", gemini_settings()
    )

    assert response.source == "live"
    assert response.skills[0].name == "Regression testing"


def test_a_fenced_json_answer_still_parses(monkeypatch: pytest.MonkeyPatch) -> None:
    """Gemini's JSON mode still wraps output in ```json fences often enough."""
    install(
        monkeypatch,
        RecordingTransport(
            gemini_body(
                '```json\n{"skills": [{"name": "Defect triage", "confidence": 0.8}],'
                ' "needs_proof": []}\n```'
            )
        ),
    )

    response = genai_hub_module.extract_skills("I triaged defects.", gemini_settings())

    assert response.source == "live"
    assert response.skills[0].name == "Defect triage"


def test_a_work_sample_through_gemini_is_labelled_live(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install(
        monkeypatch,
        RecordingTransport(gemini_body('{"score": 91, "credential_issued": true}')),
    )

    response = genai_hub_module.score_work_sample(
        "Regression testing", "A long submission.", gemini_settings()
    )

    assert response.source == "live"
    assert response.score == 91
    assert response.credential_issued is True


# ── Failure policy ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "body",
    [
        {"error": {"code": 429, "message": "Resource has been exhausted"}},
        {"candidates": []},
        {"candidates": [{"content": {"parts": []}, "finishReason": "SAFETY"}]},
        {"candidates": "not-a-list"},
    ],
    ids=["rate-limited", "no-candidates", "safety-block", "wrong-shape"],
)
def test_every_gemini_failure_degrades_to_the_fixture(
    monkeypatch: pytest.MonkeyPatch,
    body: dict[str, Any],
) -> None:
    install(monkeypatch, RecordingTransport(body))

    response = genai_hub_module.extract_skills(
        "I wrote regression tests in Jira.", gemini_settings()
    )

    assert response.source == "simulated"
    assert response.skills


def test_a_missing_key_degrades_rather_than_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A blank GEMINI_API_KEY with genai_provider=gemini is a misconfiguration,
    and the demo must keep running."""
    transport = install(monkeypatch, RecordingTransport())

    response = genai_hub_module.extract_skills(
        "I wrote regression tests in Jira.", gemini_settings(gemini_api_key="")
    )

    assert response.source == "simulated"
    assert not transport.requests


def test_mock_mode_never_calls_gemini(monkeypatch: pytest.MonkeyPatch) -> None:
    def explode(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("mock mode must not touch the network")

    monkeypatch.setattr(gemini_client, "post_generate_content", explode)

    response = genai_hub_module.extract_skills(
        "I wrote regression tests in Jira.", gemini_settings(use_mock_genai=True)
    )

    assert response.source == "simulated"


# ── The SAP path is untouched ───────────────────────────────────────────


def test_the_sap_path_is_still_reachable_when_it_is_the_chosen_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Adding Gemini must not have replaced the intended production path."""
    calls: list[Any] = []

    def record_call(payload: Any, _settings: Any) -> dict[str, Any]:
        calls.append(payload)
        return {"results": []}

    monkeypatch.setattr(genai_hub_module, "_post_to_sap", record_call)
    settings = Settings(
        use_mock_genai=False,
        genai_provider="sap",
        genai_hub_endpoint="https://hub.example.test",
        genai_hub_client_id="c",
        genai_hub_client_secret=SecretStr("s"),
        genai_hub_model="m",
    )

    genai_hub_module.post_orchestration({"messages": []}, settings)

    assert calls == [{"messages": []}]
