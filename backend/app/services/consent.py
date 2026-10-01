"""The Two-Key consent record a session keeps under ``state["consent"]``.

The orchestrator opens it as ``pending`` and waits. Exactly one answer closes
it: Kavya's yes or no through ``POST /session/{id}/consent``, or the timeout.
Every write is a versioned update, so a click that lands at the same moment as
the timeout cannot overwrite it; the loser sees ``ConsentNotPendingError``.
"""

import asyncio
from asyncio import sleep  # bound here so tests that patch asyncio.sleep miss this loop
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Final, Literal

from pydantic import JsonValue

from app.storage.session_store import (
    SessionNotFoundError,
    SessionStore,
    SessionVersionConflictError,
)

ConsentDecision = Literal["accepted", "declined", "timed_out"]

CONSENT_STATE_KEY: Final[str] = "consent"
CONSENT_POLL_SECONDS: Final[float] = 0.25
_MAX_UPDATE_ATTEMPTS: Final[int] = 5


class ConsentNotPendingError(RuntimeError):
    """The session is not waiting for an answer (not yet, or already answered)."""

    def __init__(self, session_id: str) -> None:
        super().__init__(f"session {session_id} is not waiting for consent")
        self.session_id = session_id


def pending_consent(
    keys: Sequence[str], timeout_seconds: float, phase: str = "two_key_wait"
) -> dict[str, JsonValue]:
    return {
        "phase": phase,
        "keys": list(keys),
        "state": "pending",
        "blocking": True,
        "timeout_seconds": timeout_seconds,
        "requested_at": _now(),
    }


async def decide_consent(
    store: SessionStore, session_id: str, decision: ConsentDecision
) -> dict[str, JsonValue]:
    """Close a pending consent with ``decision`` and return the stored record."""
    for _ in range(_MAX_UPDATE_ATTEMPTS):
        session = await store.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        current = session.state.get(CONSENT_STATE_KEY)
        if not isinstance(current, dict) or current.get("state") != "pending":
            raise ConsentNotPendingError(session_id)
        decided: dict[str, JsonValue] = {**current, "state": decision, "decided_at": _now()}
        try:
            await store.update(
                session.merged(state={**session.state, CONSENT_STATE_KEY: decided}),
                expected_version=session.version,
            )
        except SessionVersionConflictError:
            continue
        return decided
    raise ConsentNotPendingError(session_id)


async def await_consent(
    store: SessionStore, session_id: str, timeout_seconds: float
) -> ConsentDecision:
    """Wait for Kavya's answer; close the consent as ``timed_out`` if none comes."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout_seconds
    while True:
        answered = await _answered(store, session_id)
        if answered is not None:
            return answered
        remaining = deadline - loop.time()
        if remaining <= 0:
            try:
                await decide_consent(store, session_id, "timed_out")
            except ConsentNotPendingError:
                # An answer landed between the last read and the timeout write.
                return await _answered(store, session_id) or "timed_out"
            return "timed_out"
        await sleep(min(CONSENT_POLL_SECONDS, remaining))


async def _answered(store: SessionStore, session_id: str) -> ConsentDecision | None:
    session = await store.get(session_id)
    if session is None:
        raise SessionNotFoundError(session_id)
    current = session.state.get(CONSENT_STATE_KEY)
    state = current.get("state") if isinstance(current, dict) else None
    if state == "accepted":
        return "accepted"
    if state == "declined":
        return "declined"
    if state == "timed_out":
        return "timed_out"
    return None


def _now() -> str:
    return datetime.now(UTC).isoformat()
