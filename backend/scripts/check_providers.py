"""Preflight: is every live path actually live right now, and will it stay so?

Run this immediately before a demo, not as part of the app. It answers the one
question that matters on stage — "if I press the button, will I get `live` or
`simulated`?" — and it does that by making the real calls, so a misconfigured
provider, a dead trial instance, or an exhausted free-tier quota shows up in
five seconds instead of in front of a judge.

    python scripts/check_providers.py

Exit code 0 means every enabled live path answered with a real result. A
non-zero exit means at least one would degrade to its fixture, and the tool
names which one so it can be fixed or switched off deliberately.

Two things it deliberately does not do: it never prints a credential, and it
never mutates state. It reads the same Settings the app does, so a path green
here is green in the app.
"""

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import (  # noqa: E402
    Settings,
    describe_genai_provider,
    genai_is_configured,
)
from app.models import MatchConstraints  # noqa: E402
from app.services import genai_hub, hana_client, inclusive_matching, learning_pathway  # noqa: E402

OK = "OK  "
BAD = "FAIL"
OFF = "off "

results: list[tuple[str, bool, str]] = []


def record(name: str, live: bool, detail: str) -> None:
    results.append((name, live, detail))
    marker = OK if live else (OFF if detail.startswith("disabled") else BAD)
    print(f"  [{marker}] {name:<34} {detail}")


def check_hana(settings: Settings) -> None:
    """Confirm the HANA instance is awake and holds the seeded rows.

    The trial instance suspends when idle and the first query after a long gap
    can time out, so a green check immediately before the demo is what makes
    /match reliable on stage. Row counts are checked, not assumed: the seed
    path had a mode that reported success while writing one row.
    """
    if not hana_client.is_available(settings):
        record(
            "HANA transport",
            True,
            "disabled (USE_MOCK_HANA=true) -> /route and /match serve fixtures",
        )
        return
    try:
        expected = {
            "SKILLS_NODES": 12,
            "SKILLS_EDGES": 28,
            "ROLE_EMBEDDINGS": len(inclusive_matching.ROLE_PROFILES),
        }
        counts = {
            table: hana_client.run_scalar(settings, f"SELECT COUNT(*) FROM {table}")
            for table in expected
        }
        wrong = {t: c for t, c in counts.items() if c != expected[t]}
        if wrong:
            record("HANA rows", False, f"row count mismatch: {wrong} (wanted {expected})")
        else:
            record("HANA rows", True, f"{counts} — all present")
    except Exception as error:
        record("HANA transport", False, f"unreachable: {type(error).__name__}: {error}")
        return
    try:
        route = learning_pathway.route(settings, "Manual testing", "qa-analyst", 10)
        record(
            "/route (graph)",
            route.source == "live",
            f"source={route.source}, {route.total_hours}h over {len(route.legs)} legs",
        )
    except Exception as error:
        record("/route (graph)", False, f"raised {type(error).__name__}: {error}")


def check_match(settings: Settings) -> None:
    if not hana_client.is_available(settings):
        record(
            "/match (COSINE_SIMILARITY)",
            True,
            "disabled (USE_MOCK_HANA=true) -> matches served from the catalogue",
        )
        return
    try:
        response = inclusive_matching.match(
            settings,
            list(inclusive_matching.DEFAULT_PASSPORT_SKILLS),
            MatchConstraints(),
            candidate_annual_pay=inclusive_matching.DEFAULT_CANDIDATE_ANNUAL_PAY,
        )
        blocked = [m.role_id for m in response.matches if m.blocked_by_guardrail]
        record(
            "/match (COSINE_SIMILARITY)",
            response.source == "live",
            f"source={response.source}, {len(response.matches)} roles, "
            f"guardrail blocked {blocked or 'nothing'}",
        )
    except Exception as error:
        record("/match", False, f"raised {type(error).__name__}: {error}")


def check_genai(settings: Settings) -> None:
    """Make one real LLM call, because a 429 only appears when you call."""
    if settings.use_mock_genai:
        record(
            "LLM (skills extraction)",
            True,
            "disabled (USE_MOCK_GENAI=true) -> simulated scorer serves every request",
        )
        return
    provider = describe_genai_provider(settings)
    if not genai_is_configured(settings):
        record(
            f"LLM ({provider})",
            False,
            "selected but not configured — set the provider's credentials or switch",
        )
        return
    try:
        response = genai_hub.extract_skills(
            "I spent six years as a manual tester in Chennai, writing regression "
            "test cases in Jira and triaging production defects.",
            settings,
        )
        live = response.source == "live"
        # A free-tier 429 lands here as a simulated answer, not a raise, so the
        # detail line has to name the real cause or the operator will assume the
        # wiring is broken rather than the quota being spent.
        detail = f"provider={provider}, source={response.source}, {len(response.skills)} skills"
        if not live:
            detail += " — check the free-tier quota; a 429 degrades exactly like this"
        record(f"LLM ({provider})", live, detail)
    except Exception as error:
        record(f"LLM ({provider})", False, f"raised {type(error).__name__}: {error}")


def main() -> int:
    settings = Settings()
    print("ReRoute preflight — live paths as they are configured right now\n")
    check_hana(settings)
    check_match(settings)
    check_genai(settings)

    enabled = [entry for entry in results if not entry[2].startswith("disabled")]
    broken = [entry for entry in results if not entry[1] and not entry[2].startswith("disabled")]
    print()
    if broken:
        print(f"{len(broken)} live path(s) would degrade to their fixture:")
        for name, _, detail in broken:
            print(f"  - {name}: {detail}")
        return 1
    print(f"All {len(enabled)} enabled live path(s) answered with a real result.")
    print("Anything listed as 'disabled' is serving its bundled fixture and says so.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
