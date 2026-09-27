import { useState } from 'react'
import { decideConsent } from '../api.js'
import {
  bodyCopyClass,
  chalkClass,
  headingSmClass,
  metaClass,
  metaRowClass,
  ruleClass,
  sectionHeadingClass,
  smokeClass,
} from '../styles/classes.js'
import { Button } from './Button.jsx'
import StatusBadge from './StatusBadge.jsx'

/* Key 1 of the Two-Key rule: Kavya decides whether her passport is shared.
 *
 * The orchestrator's last node stops the run and asks. This card is where she
 * answers. With a session the answer goes to the server, which stores a
 * receipt and announces it on the event stream; with no backend (demo mode
 * with the service down) the answer is kept on this screen only and labelled
 * as such, never passed off as recorded. */

const DEFAULT_PURPOSE =
  'Share the verified skills and work-sample evidence on this Skill Passport with shortlisted employers, and accept the re-routed plan'

const EMPTY_EVENTS = []

function getErrorMessage(error) {
  return error instanceof Error && error.message
    ? error.message
    : 'The consent decision could not be recorded. Try again.'
}

function formatTime(value) {
  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? String(value ?? '')
    : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function readServerConsent(session) {
  const consent = session?.state?.consent
  const receipts = session?.state?.consent_receipts

  return {
    requested: consent !== null && typeof consent === 'object',
    purpose: typeof consent?.purpose === 'string' ? consent.purpose : null,
    receipt: Array.isArray(receipts) && receipts.length > 0 ? receipts[receipts.length - 1] : null,
  }
}

function localReceipt(decision, purpose) {
  return {
    receipt_id: `local-${Date.now().toString(36)}`,
    decision,
    state: decision === 'approve' ? 'approved' : 'revoked',
    actor: 'Kavya',
    purpose,
    decided_at: new Date().toISOString(),
    source: 'simulated',
  }
}

/**
 * @param {{
 *   baseUrl?: string,
 *   sessionId?: string | null,
 *   session?: any,
 *   events?: { agent: string, status: string }[],
 *   onDecided?: () => void,
 * }} props
 */
export default function ConsentCard({
  baseUrl = '',
  sessionId = null,
  session = null,
  events = EMPTY_EVENTS,
  onDecided,
}) {
  const [decided, setDecided] = useState(
    /** @type {{ sessionId: string | null, receipt: any }} */ ({ sessionId: null, receipt: null }),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const server = readServerConsent(session)
  const askedOnStream = events.some(
    (event) => event.agent === 'ORCHESTRATOR' && event.status === 'waiting_consent',
  )
  const requested = server.requested || askedOnStream
  // A decision belongs to the session it was made in; a new run asks again.
  const ownReceipt = decided.sessionId === sessionId ? decided.receipt : null
  const receipt = ownReceipt ?? server.receipt
  const purpose = server.purpose ?? DEFAULT_PURPOSE
  const isApproved = receipt?.state === 'approved'
  const isLocalOnly = receipt?.source === 'simulated'

  async function decide(decision) {
    if (isSaving) {
      return
    }

    setError('')

    if (!sessionId) {
      setDecided({ sessionId, receipt: localReceipt(decision, purpose) })
      return
    }

    setIsSaving(true)

    try {
      const next = await decideConsent(
        sessionId,
        { decision, actor: 'Kavya' },
        { baseUrl },
      )
      setDecided({ sessionId, receipt: next })
      onDecided?.()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      className={`border-t ${ruleClass} pt-8`}
      data-testid="consent-card"
      aria-busy={isSaving}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={sectionHeadingClass}>Key 1 · Kavya</p>
          <h3 className={`mt-2 ${headingSmClass} ${chalkClass}`}>
            {receipt !== null
              ? isApproved
                ? 'Kavya approved sharing her passport.'
                : 'Kavya’s passport is not shared.'
              : requested
                ? 'Share Kavya’s Skill Passport with shortlisted employers?'
                : 'The orchestrator has not asked yet.'}
          </h3>
          <p className={`mt-3 ${bodyCopyClass}`}>
            {requested || receipt !== null
              ? 'Shared: her verified skills and work-sample evidence. Never shared: her full CV, her voice note, and her age, gender or college — those never rank anyone.'
              : 'Press Run pipeline. When the six agents finish, the run stops here and waits for Kavya before anything leaves her passport.'}
          </p>
        </div>
        <StatusBadge
          label={receipt === null ? (requested ? 'waiting for Kavya' : 'not asked') : isLocalOnly ? 'simulated · not saved' : 'local'}
          live={false}
        />
      </div>

      {requested && receipt === null ? (
        <>
          <p className={`mt-6 ${metaClass} ${smokeClass}`}>{`Purpose · ${purpose}`}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              variant="glossy"
              onClick={() => decide('approve')}
              disabled={isSaving}
              aria-busy={isSaving}
            >
              Approve as Kavya
            </Button>
            <Button variant="ghost" onClick={() => decide('revoke')} disabled={isSaving}>
              Decline
            </Button>
          </div>
        </>
      ) : null}

      {receipt === null ? null : (
        <div className="mt-6" role="status">
          <div className="flex flex-wrap items-center gap-4">
            <StatusBadge
              tone={isApproved ? 'accent' : 'danger'}
              label={isApproved ? 'Consent given' : 'Consent withdrawn'}
            />
            <p className={`${metaClass} ${smokeClass}`}>
              {`Receipt ${receipt.receipt_id} · ${formatTime(receipt.decided_at)}`}
            </p>
          </div>
          <p className={`mt-4 ${bodyCopyClass}`}>
            {isApproved
              ? 'Logged, purpose-bound and revocable at any time, in line with India’s DPDP Act, 2023.'
              : 'Nothing from her passport goes to an employer. She can give consent again later.'}
          </p>
          <div className="mt-6">
            <Button
              variant="ghost"
              onClick={() => decide(isApproved ? 'revoke' : 'approve')}
              disabled={isSaving}
            >
              {isApproved ? 'Revoke consent' : 'Give consent again'}
            </Button>
          </div>
        </div>
      )}

      {error === '' ? null : (
        <p role="alert" className={`mt-4 ${bodyCopyClass} ${chalkClass}`}>
          {error}
        </p>
      )}

      {isLocalOnly ? (
        <div className={`mt-6 ${metaRowClass}`}>
          <span>Simulated data</span>
          <span aria-hidden="true">·</span>
          <span>No backend session, so this decision is kept on this screen only.</span>
        </div>
      ) : null}
    </div>
  )
}
