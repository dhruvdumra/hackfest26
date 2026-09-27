"""The first key of the Two-Key rule: the worker's consent to share her passport.

The orchestrator asks for consent and parks the session in ``waiting``; only a
person answering through ``POST /session/{id}/consent`` moves it on. Both sides
read the vocabulary from here so the request and the answer cannot drift.
"""

from typing import Final, Literal

ConsentState = Literal["pending", "approved", "revoked"]

CONSENT_KEYS: Final[tuple[str, ...]] = ("evidence_disclosure", "plan_acceptance")
CONSENT_PURPOSE: Final[str] = (
    "Share the verified skills and work-sample evidence on this Skill Passport with "
    "shortlisted employers, and accept the re-routed plan"
)
CONSENT_STATE_KEY: Final[str] = "consent"
CONSENT_RECEIPTS_STATE_KEY: Final[str] = "consent_receipts"
