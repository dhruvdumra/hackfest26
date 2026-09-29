"""Career GPS starts from the proven skill with the shortest bridge to the target.

It used to start from whichever canonical skill the passport happened to list
first, so the route depended on the order an LLM wrote its answer in: the same
Kavya got 70 h from "Manual testing" with one extraction and 45 h from "API
testing" with another.
"""

from app import orchestrator
from app.models import SkillClaim, SkillPassport
from app.services import learning_pathway


def passport(*claims: tuple[str, float, bool]) -> SkillPassport:
    return SkillPassport(
        passport_id="p-1",
        owner="Kavya",
        skills=[SkillClaim(name=n, confidence=c, verified=v) for n, c, v in claims],
        credentials=[],
        source="live",
    )


def test_bridge_hours_are_the_least_hours_path() -> None:
    assert learning_pathway.bridge_hours("Manual testing", "qa-analyst") == 70
    assert learning_pathway.bridge_hours("API testing", "qa-analyst") == 45
    assert learning_pathway.bridge_hours("QA analytics", "qa-analyst") is None
    assert learning_pathway.bridge_hours("Juggling", "qa-analyst") is None


def test_the_shortest_bridge_wins_whatever_the_listing_order() -> None:
    # Gemini's order for Kavya: Manual testing is the first canonical skill.
    live = passport(
        ("Defect Tracking", 1.0, True),
        ("Manual Testing", 1.0, True),
        ("Regression Testing", 1.0, True),
        ("API Testing", 0.9, True),
        ("Release Verification", 0.9, True),
    )
    # The fixture's order: API testing first.
    fixture = passport(
        ("API testing", 0.8, True),
        ("Regression testing", 0.8, True),
        ("Defect triage", 0.7, True),
    )

    assert orchestrator._route_start_skill(live, "qa-analyst") == "API testing"
    assert orchestrator._route_start_skill(fixture, "qa-analyst") == "API testing"


def test_a_skill_still_awaiting_proof_is_not_a_starting_point() -> None:
    claims = passport(("Manual testing", 0.9, True), ("SQL data validation", 0.9, False))

    assert orchestrator._route_start_skill(claims, "qa-analyst") == "Manual testing"


def test_unproven_skills_are_used_only_when_nothing_is_proven() -> None:
    claims = passport(("Manual testing", 0.9, False), ("SQL data validation", 0.9, False))

    assert orchestrator._route_start_skill(claims, "qa-analyst") == "SQL data validation"


def test_a_tie_goes_to_the_more_confident_claim() -> None:
    # API testing and Defect analytics both bridge to QA analytics in 45 h.
    claims = passport(("API testing", 0.6, True), ("Defect analytics", 0.9, True))

    assert orchestrator._route_start_skill(claims, "qa-analyst") == "Defect analytics"


def test_no_usable_skill_falls_back_to_manual_testing() -> None:
    assert orchestrator._route_start_skill(None, "qa-analyst") == "Manual testing"
    only_target = passport(("QA analytics", 1.0, True), ("Knitting", 1.0, True))
    assert orchestrator._route_start_skill(only_target, "qa-analyst") == "Manual testing"
