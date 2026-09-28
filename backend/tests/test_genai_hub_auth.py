"""The SAP Generative AI Hub authentication flow, and its failure policy.

We have no SAP AI Core trial key — the practice sandbox exposes AI Launchpad,
HANA Cloud and Build tools but no BTP Cockpit, so no service key is obtainable.
That does not excuse writing the client wrong. Before this module sent HTTP
Basic auth on the inference request, which AI Core answers with 401, so the
honest answer to "why isn't AI Core live?" would have been "the auth shape was
wrong" rather than "we had no key".

The tests below pin the two-step flow against a fake transport, in the style of
tests/test_employer_rewrite.py: no network, no key, no sleeping.

  * a token is minted with client_credentials and sent as a bearer token
  * the client secret never reaches the inference endpoint
  * a cached token is reused, and re-minted only once it is near expiry
  * no auth URL still means Basic, so nothing that worked before regresses
  * every failure degrades to the labelled simulated fixture
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.config import Settings
from app.services import genai_hub

AUTH_URL = "https://tenant.authentication.eu10.hana.ondemand.com"
ENDPOINT = "https://api.example.test/v1/inference/deployments/dep/chat/completions"
RESOURCE_GROUP = "default"
ACCESS_TOKEN = "eyJhbGciOiJFUzM4NCJ9.eyJzdWIiOiJ0cmlhbCJ9.c2lnbmF0dXJl"
EXTRACTION = {"skills": [{"name": "Regression testing", "confidence": 0.9}], "needs_proof": []}


def live_settings(**overrides: Any) -> Settings:
    defaults: dict[str, Any] = {
        "use_mock_genai": False,
        "genai_hub_endpoint": ENDPOINT,
        "genai_hub_client_id": "trial-client",
        "genai_hub_client_secret": "trial-secret",
        "genai_hub_model": "trial-model",
        "genai_hub_auth_url": AUTH_URL,
        "genai_hub_resource_group": RESOURCE_GROUP,
    }
    # Merged rather than splatted, so an override for a field that also has a
    # default is a replacement instead of a duplicate keyword argument.
    defaults.update(overrides)
    return Settings(**defaults)


class FakeTransport(httpx.BaseTransport):
    """Records every outbound request and replies from canned bodies.

    `httpx.MockTransport` alone would work, but the tests below need to assert on
    the *sequence* of calls — one token request, then N inference requests — so
    the transport keeps the full log.
    """

    def __init__(
        self,
        token_body: dict[str, Any] | None = None,
        inference_body: dict[str, Any] | None = None,
        token_status: int = 200,
    ) -> None:
        self.calls: list[httpx.Request] = []
        self._token_body: dict[str, Any] = {
            "access_token": ACCESS_TOKEN,
            "token_type": "bearer",
            "expires_in": 3600,
        }
        if token_body is not None:
            self._token_body = token_body
        self._inference_body = inference_body or EXTRACTION
        self._token_status = token_status

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if request.url.path.endswith(genai_hub.TOKEN_PATH):
            return httpx.Response(self._token_status, json=self._token_body)
        return httpx.Response(200, json=self._inference_body)

    @property
    def token_calls(self) -> list[httpx.Request]:
        return [call for call in self.calls if call.url.path.endswith(genai_hub.TOKEN_PATH)]

    @property
    def inference_calls(self) -> list[httpx.Request]:
        return [call for call in self.calls if not call.url.path.endswith(genai_hub.TOKEN_PATH)]


@pytest.fixture(autouse=True)
def clean_token_cache() -> Any:
    """The token cache is module state; no test may leak a token into the next."""
    genai_hub.reset_token_cache()
    yield
    genai_hub.reset_token_cache()


def install(monkeypatch: pytest.MonkeyPatch, transport: FakeTransport) -> FakeTransport:
    original = httpx.Client

    def patched(*args: Any, **kwargs: Any) -> httpx.Client:
        kwargs["transport"] = transport
        return original(*args, **kwargs)

    monkeypatch.setattr(httpx, "Client", patched)
    return transport


# ── The two-step flow ───────────────────────────────────────────────────


def test_a_bearer_token_is_minted_and_sent(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = install(monkeypatch, FakeTransport())
    settings = live_settings()

    assert genai_hub._access_token(settings) == ACCESS_TOKEN
    assert transport.token_calls[0].url == f"{AUTH_URL}{genai_hub.TOKEN_PATH}"

    form = dict(httpx.QueryParams(transport.token_calls[0].content.decode()))
    assert form["grant_type"] == "client_credentials"
    assert form["client_id"] == "trial-client"
    assert form["client_secret"] == "trial-secret"


def test_the_client_secret_never_reaches_the_inference_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The whole point of the exchange: a token, not the credential, is sent."""
    transport = install(monkeypatch, FakeTransport())
    settings = live_settings()

    genai_hub.post_orchestration({"model": "trial-model"}, settings)

    assert transport.inference_calls
    for call in transport.inference_calls:
        assert call.headers["Authorization"] == f"Bearer {ACCESS_TOKEN}"
        assert "trial-secret" not in call.content.decode()
        # No Basic auth header anywhere on the inference request.
        assert not call.headers.get("Authorization", "").startswith("Basic")
        assert call.headers.get("X-Api-Key") is None


def test_the_resource_group_is_sent_as_its_own_header(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = install(monkeypatch, FakeTransport())

    genai_hub.post_orchestration({"model": "trial-model"}, live_settings())

    assert transport.inference_calls[0].headers["AI-Resource-Group"] == RESOURCE_GROUP


def test_a_blank_resource_group_omits_the_header(monkeypatch: pytest.MonkeyPatch) -> None:
    """An empty header is a 403 at AI Core, so it must be absent, not blank."""
    transport = install(monkeypatch, FakeTransport())

    genai_hub.post_orchestration(
        {"model": "trial-model"}, live_settings(genai_hub_resource_group="")
    )

    assert "AI-Resource-Group" not in transport.inference_calls[0].headers


# ── Token caching ───────────────────────────────────────────────────────


def test_a_token_is_minted_once_and_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    """Seven streamed agent events must not mean seven auth round trips."""
    transport = install(monkeypatch, FakeTransport())
    settings = live_settings()

    for _ in range(7):
        genai_hub.post_orchestration({"model": "trial-model"}, settings)

    assert len(transport.token_calls) == 1
    assert len(transport.inference_calls) == 7


def test_a_token_past_its_margin_is_re_minted(monkeypatch: pytest.MonkeyPatch) -> None:
    """The margin is what stops a token expiring between two streamed events."""
    transport = install(
        monkeypatch, FakeTransport(token_body={"access_token": "first", "expires_in": 30})
    )
    settings = live_settings(genai_hub_token_expiry_margin_seconds=30.0)

    assert genai_hub._access_token(settings) == "first"
    # 30s lifetime minus a 30s margin is already stale, so the next call re-mints.
    assert genai_hub._access_token(settings) == "first"
    assert len(transport.token_calls) == 2


def test_a_token_within_its_margin_is_still_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = install(
        monkeypatch, FakeTransport(token_body={"access_token": "only", "expires_in": 3600})
    )
    settings = live_settings(genai_hub_token_expiry_margin_seconds=30.0)

    assert genai_hub._access_token(settings) == "only"
    assert genai_hub._access_token(settings) == "only"
    assert len(transport.token_calls) == 1


def test_different_credentials_do_not_share_a_cached_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two Settings in one process must not hand each other's tokens out.

    The assertion is on the number of mints, not on the token values: the fake
    transport answers every token request identically, so a shared cache would
    show up as one call instead of two.
    """
    transport = install(monkeypatch, FakeTransport())

    genai_hub._access_token(live_settings())
    genai_hub._access_token(live_settings(genai_hub_client_id="other-client"))
    genai_hub._access_token(live_settings(genai_hub_auth_url="https://other.test"))
    # Same credentials again: that one must come from the cache.
    genai_hub._access_token(live_settings())

    assert len(transport.token_calls) == 3


def test_reset_token_cache_forces_a_re_mint(monkeypatch: pytest.MonkeyPatch) -> None:
    transport = install(monkeypatch, FakeTransport())
    settings = live_settings()

    genai_hub._access_token(settings)
    genai_hub.reset_token_cache()
    genai_hub._access_token(settings)

    assert len(transport.token_calls) == 2


def test_a_token_response_without_a_lifetime_still_caches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An absent expires_in must not mean re-minting on every event."""
    transport = install(monkeypatch, FakeTransport(token_body={"access_token": "no-expiry"}))
    settings = live_settings()

    genai_hub._access_token(settings)
    genai_hub._access_token(settings)

    assert len(transport.token_calls) == 1


def test_a_non_numeric_lifetime_falls_back_to_the_documented_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = install(
        monkeypatch, FakeTransport(token_body={"access_token": "weird", "expires_in": "soon"})
    )
    settings = live_settings()

    genai_hub._access_token(settings)
    genai_hub._access_token(settings)

    assert len(transport.token_calls) == 1
    assert genai_hub.DEFAULT_TOKEN_LIFETIME_SECONDS == 3600.0


# ── URL handling ────────────────────────────────────────────────────────


def test_the_token_path_is_not_appended_twice() -> None:
    assert genai_hub._token_url(f"{AUTH_URL}/oauth/token") == f"{AUTH_URL}/oauth/token"
    assert genai_hub._token_url(f"{AUTH_URL}/") == f"{AUTH_URL}/oauth/token"
    assert genai_hub._token_url(AUTH_URL) == f"{AUTH_URL}/oauth/token"


# ── The Basic fallback ──────────────────────────────────────────────────


def test_no_auth_url_keeps_basic_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    """Nothing that worked before may regress when the new field is blank."""
    transport = install(monkeypatch, FakeTransport())
    settings = live_settings(genai_hub_auth_url="")

    genai_hub.post_orchestration({"model": "trial-model"}, settings)

    assert not transport.token_calls
    assert transport.inference_calls[0].headers["Authorization"].startswith("Basic ")


def test_a_blank_auth_url_asks_for_no_token_at_all() -> None:
    assert genai_hub._access_token(live_settings(genai_hub_auth_url="")) is None


# ── Failure policy ──────────────────────────────────────────────────────


def test_a_rejected_token_exchange_degrades_to_the_fixture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    install(monkeypatch, FakeTransport(token_status=401))
    settings = live_settings()

    response = genai_hub.extract_skills("I wrote regression tests in Jira for six years.", settings)

    assert response.source == "simulated"
    assert response.skills


def test_a_token_response_without_a_token_degrades(monkeypatch: pytest.MonkeyPatch) -> None:
    install(monkeypatch, FakeTransport(token_body={"token_type": "bearer", "expires_in": 3600}))

    response = genai_hub.extract_skills("I wrote regression tests in Jira.", live_settings())

    assert response.source == "simulated"


def test_a_failing_inference_call_degrades_to_the_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    class Failing(FakeTransport):
        def handle_request(self, request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith(genai_hub.TOKEN_PATH):
                return httpx.Response(200, json={"access_token": ACCESS_TOKEN, "expires_in": 3600})
            return httpx.Response(401, json={"error": "unauthorized"})

    install(monkeypatch, Failing())

    response = genai_hub.extract_skills("I wrote regression tests in Jira.", live_settings())

    assert response.source == "simulated"


def test_a_work_sample_also_degrades(monkeypatch: pytest.MonkeyPatch) -> None:
    """The work-sample agent shares post_orchestration, so it shares the policy."""
    install(monkeypatch, FakeTransport(token_status=403))

    response = genai_hub.score_work_sample(
        "Regression testing", "A detailed submission.", live_settings()
    )

    assert response.source == "simulated"
    assert 0 <= response.score <= 100


def test_a_live_extraction_is_labelled_live(monkeypatch: pytest.MonkeyPatch) -> None:
    """The point of all of the above: a real answer says `live`."""
    install(monkeypatch, FakeTransport(inference_body=EXTRACTION))

    response = genai_hub.extract_skills("I wrote regression tests in Jira.", live_settings())

    assert response.source == "live"
    assert response.skills[0].name == "Regression testing"


def test_mock_mode_never_mints_a_token(monkeypatch: pytest.MonkeyPatch) -> None:
    def explode(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("mock mode must not touch the network")

    monkeypatch.setattr(genai_hub, "_mint_token", explode)
    settings = live_settings(use_mock_genai=True)

    assert genai_hub.extract_skills("I wrote regression tests in Jira.", settings).source == (
        "simulated"
    )


def test_a_token_inside_its_lifetime_is_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    """A 1s lifetime with a zero margin is still cached, and only re-minted later.

    No sleeping: the cache is keyed on the monotonic clock, so a second call
    inside the same test proves reuse without spending a second of wall time.
    """
    transport = install(
        monkeypatch, FakeTransport(token_body={"access_token": "short", "expires_in": 1})
    )
    settings = live_settings(genai_hub_token_expiry_margin_seconds=0.0)

    assert genai_hub._access_token(settings) == "short"
    assert genai_hub._access_token(settings) == "short"
    assert len(transport.token_calls) == 1
