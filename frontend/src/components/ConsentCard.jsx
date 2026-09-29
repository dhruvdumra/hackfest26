import { useState } from 'react'
import { decideConsent } from '../api.js'
import {
  bodyClass,
  bodyCopyClass,
  chalkClass,
  headingSmClass,
  readingClass,
  ruleClass,
  sectionHeadingClass,
} from '../styles/classes.js'
import { readConsent } from '../domain/consent.js'
import { Button } from './Button.jsx'
import StatusBadge from './StatusBadge.jsx'

const OUTCOME_COPY = {
  accepted: 'Kavya said yes. Her Skill Passport is shared with employers.',
  declined: 'Kavya said no. Her Skill Passport stays private.',
  timed_out: 'No answer came in time, so nothing was shared.',
}

const OUTCOME_BADGE = {
  accepted: 'shared',
  declined: 'kept private',
  timed_out: 'timed out',
}

function getAnswerError(error) {
  if (typeof error === 'object' && error !== null && error.status === 409) {
    return 'This run is no longer waiting for an answer.'
  }

  return 'Kavya’s answer could not be recorded. Try again.'
}

/**
 * The Two-Key consent prompt. Nothing about Kavya leaves ReRoute until she
 * says yes.
 *
 * With a live session the answer goes to the backend, and the card waits for
 * the orchestrator's closing event rather than trusting its own click. In demo
 * mode there is no session to answer, so the click is handed to
 * `onLocalDecision` and the card says plainly that nothing was sent.
 *
 * @param {{
 *   events: Array<{ agent: string, status: string, data?: any }>,
 *   live?: boolean,
 *   sessionId?: string | null,
 *   baseUrl?: string,
 *   onLocalDecision?: (decision: 'accepted' | 'declined') => void,
 * }} props
 */
export default function ConsentCard({
  events,
  live = false,
  sessionId = null,
  baseUrl = '',
  onLocalDecision,
}) {
  const [isSending, setIsSending] = useState(false)
  const [answerError, setAnswerError] = useState('')
  const consent = readConsent(events)

  if (consent === 'idle') {
    return null
  }

  async function answer(accepted) {
    setAnswerError('')

    if (!live || !sessionId) {
      onLocalDecision?.(accepted ? 'accepted' : 'declined')
      return
    }

    setIsSending(true)

    try {
      await decideConsent(sessionId, accepted, { baseUrl })
    } catch (error) {
      setAnswerError(getAnswerError(error))
      setIsSending(false)
    }
  }

  const answered = consent !== 'waiting'
  const badgeLabel = answered
    ? live
      ? OUTCOME_BADGE[consent]
      : 'demo mode · not sent'
    : isSending
      ? 'recording'
      : 'awaiting Kavya'
  const badgeTone = answered && live && consent !== 'timed_out' ? 'accent' : 'muted'

  return (
    <section
      aria-labelledby="consent-heading"
      className={`border-t ${ruleClass} pt-8`}
      data-testid="consent-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className={sectionHeadingClass}>Two-Key consent</p>
        <StatusBadge tone={badgeTone} label={badgeLabel} />
      </div>
      <h3 id="consent-heading" className={`mt-4 ${headingSmClass} ${chalkClass}`}>
        Share Kavya’s Skill Passport with employers?
      </h3>

      {answered ? (
        <p className={`mt-3 ${readingClass} ${bodyClass} ${chalkClass}`} role="status">
          {OUTCOME_COPY[consent]}
        </p>
      ) : (
        <>
          <p className={`mt-3 ${bodyCopyClass}`}>
            Nothing leaves ReRoute until she says yes. The passport holds her
            verified skills and credentials, never her age, gender, college or
            career gap.
          </p>
          <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="glossy"
              onClick={() => answer(true)}
              disabled={isSending}
              aria-busy={isSending}
            >
              Yes, share it
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => answer(false)}
              disabled={isSending}
            >
              No, keep it private
            </Button>
          </div>
          {isSending ? (
            <p className={`mt-4 ${bodyCopyClass}`} role="status">
              Recording Kavya’s answer…
            </p>
          ) : null}
          {answerError === '' ? null : (
            <p className={`mt-4 ${readingClass} ${bodyClass} ${chalkClass}`} role="alert">
              {answerError}
            </p>
          )}
        </>
      )}
    </section>
  )
}
