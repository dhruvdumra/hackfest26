"""The first key of the Two-Key rule, as an endpoint.

The orchestrator's last node parks a session in ``waiting`` with a pending
consent request. ``POST /session/{id}/consent`` is the only way forward: the
worker approves sharing her passport, or revokes it. Each answer is a receipt —
logged, purpose-bound and revocable, as the deck promises under India's DPDP
Act — appended to the session, and announced on the session's event stream so
a connected console sees the human decision land.
"""

import logging
from datetime import UTC, datetime
from typing import Final
from uuid import uuid4

from fastapi import APIRouter, HTTPException, status
from pydantic import JsonValue

from app.api.dependencies import SessionStoreDependency
from app.domain.consent import (
    CONSENT_KEYS,
    CONSENT_PURPOSE,
    CONSENT_RECEIPTS_STATE_KEY,
    CONSENT_STATE_KEY,
)
from app.models import AgentEvent, ConsentReceipt, ConsentRequest, SessionState
from app.orchestrator import EventEmitter
from app.realtime import RealtimeRegistryDependency
from app.storage.session_store import SessionVersionConflictError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/session", tags=["consent"])

SESSION_WRITE_ATTEMPTS: Final[int] = 3


@router.post("/{session_id}/consent", response_model=ConsentReceipt)
async def decide_consent(
    session_id: str,
    request: ConsentRequest,
    session_store: SessionStoreDependency,
    registry: RealtimeRegistryDependency,
) -> ConsentReceipt:
    receipt: ConsentReceipt | None = None
    for _ in range(SESSION_WRITE_ATTEMPTS):
        session = await session_store.get(session_id)
        if session is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        receipt = _receipt_for(session, request)
        try:
            await session_store.update(
                _with_decision(session, receipt),
                expected_version=session.version,
            )
        except SessionVersionConflictError:
            logger.info("session %s moved under /consent; retrying", session_id)
            continue
        break
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Session is being updated concurrently; retry the request",
        )

    async def broadcast(event: AgentEvent) -> None:
        await registry.broadcast(session_id, event)

    emitter = EventEmitter(session_id=session_id, store=session_store, on_event=broadcast)
    await emitter.hydrate()
    await emitter.emit(
        agent="ORCHESTRATOR",
        status="done",
        message=_event_message(receipt),
        data={
            "phase": "two_key_consent",
            "decision": receipt.decision,
            "consent_state": receipt.state,
            "receipt_id": receipt.receipt_id,
            "keys": list[JsonValue](receipt.keys),
            "terminal": True,
            "session_status": receipt.session_status,
        },
        source="local",
    )
    return receipt


def _receipt_for(session: SessionState, request: ConsentRequest) -> ConsentReceipt:
    consent = session.state.get(CONSENT_STATE_KEY)
    if not isinstance(consent, dict):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The orchestrator has not asked for consent on this session yet",
        )
    current = consent.get("state")
    if request.decision == "approve" and current == "approved":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Consent is already approved; revoke it first to change it",
        )
    if request.decision == "revoke" and current == "revoked":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Consent is already revoked",
        )
    if current not in {"pending", "approved", "revoked"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This session's consent request is not in a state that can be answered",
        )
    purpose = consent.get("purpose")
    return ConsentReceipt(
        receipt_id=f"consent-{uuid4().hex[:12]}",
        session_id=session.session_id,
        decision=request.decision,
        state="approved" if request.decision == "approve" else "revoked",
        actor=request.actor.strip() or "Kavya",
        purpose=purpose if isinstance(purpose, str) else CONSENT_PURPOSE,
        keys=list(CONSENT_KEYS),
        decided_at=datetime.now(UTC),
        session_status="completed",
    )


def _with_decision(session: SessionState, receipt: ConsentReceipt) -> SessionState:
    consent = session.state.get(CONSENT_STATE_KEY)
    previous = consent if isinstance(consent, dict) else {}
    receipts = session.state.get(CONSENT_RECEIPTS_STATE_KEY)
    history = receipts if isinstance(receipts, list) else []
    stored_receipt: JsonValue = receipt.model_dump(mode="json")
    return session.merged(
        status=receipt.session_status,
        state={
            **session.state,
            CONSENT_STATE_KEY: {
                **previous,
                "state": receipt.state,
                "blocking": False,
                "receipt_id": receipt.receipt_id,
                "actor": receipt.actor,
                "decided_at": receipt.decided_at.isoformat(),
            },
            CONSENT_RECEIPTS_STATE_KEY: [*history, stored_receipt],
        },
    )


def _event_message(receipt: ConsentReceipt) -> str:
    if receipt.decision == "approve":
        return (
            f"{receipt.actor} approved · passport shared with shortlisted employers · "
            f"receipt {receipt.receipt_id}"
        )
    return f"{receipt.actor} revoked consent · passport withdrawn · receipt {receipt.receipt_id}"
