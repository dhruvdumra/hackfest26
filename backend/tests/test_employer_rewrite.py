"""The Employer Readiness filter rewrite, and the honesty of its labels.

The point of this module is not that a model rewrites a job post. Plenty of
things do that. The point is that the rewrite is *derived from the bias audit
that ran in the same session*, and that the response says which of the two
happened.

So the tests below are mostly about provenance:

  * a live model, given a flagged audit, produces a different rewrite and is
    labelled ``live`` with ``derived_from_audit=True``
  * the same live model given a clean audit is NOT asked to rewrite anything,
    because there is no finding to act on
  * a fixture answer never claims derivation, even when an audit was supplied
  * a failing model never turns a working demo into a broken one

The last one matters most on stage: a rate-limited Hub must degrade to the
bundled text and keep the pipeline running, not raise.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.mocks.employer_fixtures import JOB_POSTS
from app.models import GhostTwinResult, GhostTwinVariant

POST_ID = JOB_POSTS[0]["post_id"]

# A transcript long enough for the skills agent to find something, so the
# orchestrated run in the node-order test actually reaches Employer Readiness.
KAVYA_TRANSCRIPT = (
    "I worked four years as a manual tester in Chennai. I wrote test case "
    "design documents in Excel, owned defect reporting in Jira, ran regression "
    "passes on the signup journey, and kept Postman collections for the public "
    "API. I have never written Selenium and never configured CI. I can give ten "
    "hours a week to learning."
)

# A legacy screen that penalises an 18-month career break by six points and a
# tier-2 college by three, and does not care about gender, age or city. This is
# the shape the bias audit produces in real use.
LEAKY_AUDIT = GhostTwinResult(
    actual_score=94,
    max_delta=6,
    result="FLAGGED",
    threshold=5,
    twins=[
        GhostTwinVariant(
            variant="career_gap_counterfactual",
            attribute="career_gap",
            original_value="18 months",
            counterfactual_value={"months": 0},
            score=100,
            delta=6,
        ),
        GhostTwinVariant(
            variant="gender_counterfactual",
            attribute="gender",
            original_value="female",
            counterfactual_value="male",
            score=94,
            delta=0,
        ),
        GhostTwinVariant(
            variant="age_counterfactual",
            attribute="age",
            original_value=29,
            counterfactual_value=30,
            score=94,
            delta=0,
        ),
        GhostTwinVariant(
            variant="college_tier_counterfactual",
            attribute="college_tier",
            original_value="tier_2",
            counterfactual_value="tier_1",
            score=91,
            delta=-3,
        ),
        GhostTwinVariant(
            variant="city_counterfactual",
            attribute="city",
            original_value="Chennai",
            counterfactual_value="Bengaluru",
            score=98,
            delta=4,
        ),
    ],
)

# Every twin flat: nothing was penalised, so there is nothing to rewrite.
CLEAN_AUDIT = GhostTwinResult(
    actual_score=86,
    max_delta=0,
    result="PASS",
    threshold=5,
    twins=[
        GhostTwinVariant(
            variant=f"{attribute}_counterfactual",
            attribute=attribute,  # type: ignore[arg-type]
            original_value="x",
            counterfactual_value="y",
            score=86,
            delta=0,
        )
        for attribute in ("career_gap", "gender", "age", "college_tier", "city")
    ],
)

MODEL_REWRITE = {
    "filter_text_after": (
        "QA analyst with evidence of regression, defect triage and API testing. "
        "A career break is acceptable where the evidence is current."
    ),
    "removed_criteria": ["aged 22-28", "tier-1 college requirement", "no career break"],
    "rewrite_reason": "Removed the age and college filters the audit penalised.",
}


def build_client(tmp_path: Path, **overrides: Any) -> TestClient:
    return TestClient(create_app(Settings(database_path=tmp_path / "reroute.db", **overrides)))


def live_settings(**overrides: Any) -> dict[str, Any]:
    return {
        "use_mock_genai": False,
        "genai_hub_endpoint": "https://genai.example.test/v1/orchestration",
        "genai_hub_client_id": "client",
        "genai_hub_client_secret": "secret",
        "genai_hub_model": "trial-model",
        **overrides,
    }


def hub_returns(document: Any) -> Any:
    """A Hub response shaped like a real orchestration envelope.

    ``document`` is a Python object; it is serialised here so the test never
    hand-builds JSON. String-formatting a dict into a JSON literal is exactly the
    kind of thing that produces a subtly invalid body and makes a parsing test
    fail for the wrong reason.
    """
    body = json.dumps(document)
    return lambda *_, **__: {
        "results": [{"output": {"choices": [{"message": {"content": f"```json\n{body}\n```"}}]}}]
    }


# ── The fixture path ─────────────────────────────────────────────────────


def test_rewrite_without_an_audit_is_the_fixture_and_says_so(tmp_path: Path) -> None:
    post = JOB_POSTS[0]
    with build_client(tmp_path) as client:
        response = client.post("/employer/rewrite-filter", json={"job_post_id": POST_ID})

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "simulated"
    assert payload["derived_from_audit"] is False
    assert payload["audit_attributes"] == []
    # Unchanged behaviour: the before/after pair is still the bundled one.
    assert payload["filter_text_before"] == post["filter_text_before"]
    assert payload["filter_text_after"] == post["filter_text_after"]
    assert payload["hidden_talent_count"] == post["hidden_talent_count"]
    assert payload["disclaimer"]


def test_a_fixture_never_claims_it_was_derived_from_an_audit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mock mode plus a flagged audit must not report ``derived_from_audit``.

    This is the load-bearing honesty test. The fixture text reads well and
    happens to match the audit's findings, which is exactly why a reader needs
    the flag to say the text did not come from this audit.
    """

    def explode(*_: object, **__: object) -> object:
        raise AssertionError("mock mode must not call the model")

    monkeypatch.setattr("app.services.employer_rewrite._post_orchestration", explode)
    with build_client(tmp_path, use_mock_genai=True) as client:
        response = client.post(
            "/employer/rewrite-filter",
            json={"job_post_id": POST_ID, "audit_result": LEAKY_AUDIT.model_dump()},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "simulated"
    assert payload["derived_from_audit"] is False
    # The attributes that motivated the request are still reported, worst
    # penalty first, so a reader can see which finding was on the table.
    assert payload["audit_attributes"] == ["career_gap", "city", "college_tier"]


def test_the_orchestrated_node_cannot_derive_and_says_so(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The pipeline's Employer Readiness node runs on the fixture, by design.

    Two independent reasons, both of which a future reader will otherwise try to
    "fix" by reordering the graph:

      * ``employer_readiness`` is node five and ``bias_audit`` is node six, so
        there is no session audit to derive from yet;
      * even reordered, the orchestrator audits the *fair* model
        (``simulate_legacy_ats`` is never passed), which yields every delta at
        zero and a PASS — no finding, nothing to act on.

    The event must therefore report ``derived_from_audit: False`` and must not
    call the model, or the pipeline would be claiming a causal link it never
    made.
    """

    def explode(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("the orchestrated node must not call the model")

    monkeypatch.setattr("app.services.employer_rewrite._post_orchestration", explode)
    with build_client(tmp_path, **live_settings()) as client:
        session = client.post(
            "/session/start",
            json={"input_type": "text", "persona": "Kavya", "content": KAVYA_TRANSCRIPT},
        )

    assert session.status_code == 200
    session_id = session.json()["session_id"]

    # The node emits into the event log; the store is polled for the brief.
    with build_client(tmp_path, **live_settings()) as reader:
        state = reader.get(f"/session/{session_id}")

    assert state.status_code == 200
    brief = state.json()["state"].get("employer_readiness")
    assert brief is not None
    assert brief.get("source") == "simulated"
    # The flag is absent from the fixture brief, which is itself the honest
    # signal: nothing claimed derivation.
    assert not brief.get("derived_from_audit")


def test_a_clean_audit_is_not_acted_on(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A PASS with every delta at zero has no finding, so no model is called.

    Rewriting a post because nothing was wrong would be inventing a problem.
    """

    def explode(*_: object, **__: object) -> object:
        raise AssertionError("a clean audit must not trigger a rewrite")

    monkeypatch.setattr("app.services.employer_rewrite._post_orchestration", explode)
    with build_client(tmp_path, **live_settings()) as client:
        response = client.post(
            "/employer/rewrite-filter",
            json={"job_post_id": POST_ID, "audit_result": CLEAN_AUDIT.model_dump()},
        )

    assert response.status_code == 200
    assert response.json()["source"] == "simulated"
    assert response.json()["derived_from_audit"] is False


# ── The live path ────────────────────────────────────────────────────────


def test_a_flagged_audit_produces_a_live_derived_rewrite(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.employer_rewrite._post_orchestration",
        hub_returns(MODEL_REWRITE),
    )
    with build_client(tmp_path, **live_settings()) as client:
        response = client.post(
            "/employer/rewrite-filter",
            json={"job_post_id": POST_ID, "audit_result": LEAKY_AUDIT.model_dump()},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "live"
    assert payload["derived_from_audit"] is True
    # Only the penalised attributes, worst magnitude first: career_gap +6, then
    # city +4, then college_tier -3. gender/age sat at zero and are excluded, so
    # the model is never invited to "fix" something the audit explicitly
    # cleared.
    assert payload["audit_attributes"] == ["career_gap", "city", "college_tier"]
    assert "career break is acceptable" in payload["filter_text_after"]
    assert "aged 22-28" in payload["removed_criteria"]


def test_the_prompt_names_only_the_penalised_attributes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The model is told which attributes cost points, in candidate terms.

    Asserting on the prompt is the only way to prove the rewrite is driven by
    the audit rather than by a generic instruction that would produce the same
    text for any input.
    """
    seen: dict[str, Any] = {}

    def capture(payload: dict[str, Any], *_args: object, **_kwargs: object) -> Any:
        seen.update(payload)
        return {"filter_text_after": "Rewritten without the penalised filters."}

    monkeypatch.setattr("app.services.employer_rewrite._post_orchestration", capture)
    with build_client(tmp_path, **live_settings()) as client:
        client.post(
            "/employer/rewrite-filter",
            json={"job_post_id": POST_ID, "audit_result": LEAKY_AUDIT.model_dump()},
        )

    system_prompt = seen["messages"][0]["content"]
    assert "employment gap" in system_prompt
    assert "which college a candidate attended" in system_prompt
    assert "changed the score by +6 points" in system_prompt
    # A neutral attribute is not raised as a problem.
    assert "candidates' gender" not in system_prompt
    assert seen["messages"][1]["content"] == JOB_POSTS[0]["filter_text_before"]


def test_different_findings_produce_different_prompts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two audits, two different instructions.

    This is the question a reviewer asks first — "what if the audit had flagged
    something else?" — and the answer has to be observable.
    """
    gender_only = GhostTwinResult(
        actual_score=80,
        max_delta=9,
        result="FLAGGED",
        threshold=5,
        twins=[
            GhostTwinVariant(
                variant="gender_counterfactual",
                attribute="gender",
                original_value="female",
                counterfactual_value="male",
                score=89,
                delta=9,
            )
        ],
    )
    prompts: list[str] = []

    def capture(payload: dict[str, Any], *_args: object, **_kwargs: object) -> Any:
        prompts.append(payload["messages"][0]["content"])
        return {"filter_text_after": "Rewritten."}

    monkeypatch.setattr("app.services.employer_rewrite._post_orchestration", capture)
    with build_client(tmp_path, **live_settings()) as client:
        client.post(
            "/employer/rewrite-filter",
            json={"job_post_id": POST_ID, "audit_result": LEAKY_AUDIT.model_dump()},
        )
        client.post(
            "/employer/rewrite-filter",
            json={"job_post_id": POST_ID, "audit_result": gender_only.model_dump()},
        )

    assert len(prompts) == 2
    assert prompts[0] != prompts[1]
    assert "candidates' gender" in prompts[1]
    assert "employment gap" not in prompts[1]


# ── Resilience ───────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "failure",
    [
        RuntimeError("GenAI Hub unreachable"),
        TimeoutError("orchestration timed out"),
    ],
)
def test_a_failing_model_degrades_to_the_fixture(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
) -> None:
    def explode(*_args: object, **_kwargs: object) -> object:
        raise failure

    monkeypatch.setattr("app.services.employer_rewrite._post_orchestration", explode)
    with build_client(tmp_path, **live_settings()) as client:
        response = client.post(
            "/employer/rewrite-filter",
            json={"job_post_id": POST_ID, "audit_result": LEAKY_AUDIT.model_dump()},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["source"] == "simulated"
    assert payload["derived_from_audit"] is False
    assert payload["filter_text_after"] == JOB_POSTS[0]["filter_text_after"]


def test_a_model_returning_prose_instead_of_json_degrades(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A refusal or a chatty answer must not become a 500 on stage."""
    monkeypatch.setattr(
        "app.services.employer_rewrite._post_orchestration",
        lambda *_, **__: {"results": [{"output": {"content": "I'm sorry, I can't help."}}]},
    )
    with build_client(tmp_path, **live_settings()) as client:
        response = client.post(
            "/employer/rewrite-filter",
            json={"job_post_id": POST_ID, "audit_result": LEAKY_AUDIT.model_dump()},
        )

    assert response.status_code == 200
    assert response.json()["source"] == "simulated"
    assert response.json()["derived_from_audit"] is False


def test_a_rewrite_without_the_required_field_degrades(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.services.employer_rewrite._post_orchestration",
        lambda *_, **__: {"results": [{"output": {"content": '{"rewrite_reason": "done"}'}}]},
    )
    with build_client(tmp_path, **live_settings()) as client:
        response = client.post(
            "/employer/rewrite-filter",
            json={"job_post_id": POST_ID, "audit_result": LEAKY_AUDIT.model_dump()},
        )

    assert response.status_code == 200
    assert response.json()["source"] == "simulated"


def test_an_unknown_post_is_a_404_with_the_known_ids(
    tmp_path: Path,
) -> None:
    with build_client(tmp_path) as client:
        response = client.post(
            "/employer/rewrite-filter",
            json={"job_post_id": "post-does-not-exist"},
        )

    assert response.status_code == 404
    assert POST_ID in response.json()["detail"]


def test_the_audit_payload_is_optional_and_validated(
    tmp_path: Path,
) -> None:
    """A malformed audit is a client error, not a silent fixture."""
    with build_client(tmp_path) as client:
        rejected = client.post(
            "/employer/rewrite-filter",
            json={"job_post_id": POST_ID, "audit_result": {"result": "MAYBE"}},
        )
        no_post = client.post("/employer/rewrite-filter", json={})

    assert rejected.status_code == 422
    assert no_post.status_code == 422
