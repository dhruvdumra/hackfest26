import { useEffect, useState } from 'react'
import { decideEmployerRewrite, getEmployerDecision } from '../api.js'
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
import Field from './Field.jsx'
import StatusBadge from './StatusBadge.jsx'
import TextInput from './TextInput.jsx'

/* Key 2 of the Two-Key rule: the hiring manager signs off the rewrite.
 *
 * Employer Readiness drafts the new wording, but the deck's promise is that a
 * human decides — so the rewrite is not "done" until someone with a name
 * approves or rejects it, and the decision is stored with that name and a
 * time. A reversal is a second decision, not an edit of the first. */

const DECISION_COPY = {
  approve: {
    label: 'Approved',
    tone: /** @type {'accent'} */ ('accent'),
    detail: 'The rewritten post replaces the original.',
  },
  reject: {
    label: 'Rejected',
    tone: /** @type {'danger'} */ ('danger'),
    detail: 'The original post stays up, and the audit flag stays on it.',
  },
}

function formatTime(value) {
  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? String(value ?? '')
    : date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function getErrorMessage(error) {
  return error instanceof Error && error.message
    ? error.message
    : 'The decision could not be recorded. Try again.'
}

function isNotFound(error) {
  return typeof error === 'object' && error !== null && /** @type {{ status?: unknown }} */ (error).status === 404
}

/**
 * @param {{ baseUrl?: string, jobPostId: string, hiddenTalentCount?: number | null }} props
 */
export default function HiringDecision({ baseUrl = '', jobPostId, hiddenTalentCount = null }) {
  const [reviewer, setReviewer] = useState('Hiring manager')
  // The stored decision for this post, keyed by post so a switch to another
  // post never shows the previous post's sign-off while the new one loads.
  const [stored, setStored] = useState(
    /** @type {{ jobPostId: string | null, record: any }} */ ({ jobPostId: null, record: null }),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [isChanging, setIsChanging] = useState(false)
  const isLoading = stored.jobPostId !== jobPostId
  const decision = isLoading ? null : stored.record

  useEffect(() => {
    const controller = new AbortController()

    getEmployerDecision(jobPostId, { baseUrl, signal: controller.signal })
      .then((record) => {
        if (!controller.signal.aborted) {
          setStored({ jobPostId, record })
        }
      })
      .catch((requestError) => {
        if (controller.signal.aborted) {
          return
        }

        // No decision yet is the normal starting state, not a failure. Any
        // other error still leaves the buttons usable.
        setStored({ jobPostId, record: null })
        if (!isNotFound(requestError)) {
          setError(getErrorMessage(requestError))
        }
      })

    return () => controller.abort()
  }, [baseUrl, jobPostId])

  async function decide(nextDecision) {
    if (isSaving) {
      return
    }

    setIsSaving(true)
    setError('')

    try {
      const record = await decideEmployerRewrite(
        jobPostId,
        { decision: nextDecision, reviewer: reviewer.trim() || 'Hiring manager' },
        { baseUrl },
      )
      setStored({ jobPostId, record })
      setIsChanging(false)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsSaving(false)
    }
  }

  const copy = decision === null ? null : DECISION_COPY[decision.decision]
  const showForm = decision === null || isChanging

  return (
    <div
      className={`mt-12 border-t ${ruleClass} pt-8`}
      data-testid="hiring-decision"
      aria-busy={isSaving || isLoading}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={sectionHeadingClass}>Key 2 · Hiring manager</p>
          <h4 className={`mt-2 ${headingSmClass} ${chalkClass}`}>
            {copy === null ? 'Publish the rewritten post?' : `${copy.label} by ${decision.reviewer}`}
          </h4>
          <p className={`mt-3 ${bodyCopyClass}`}>
            {copy === null
              ? `The agent drafted this rewrite${
                  typeof hiddenTalentCount === 'number' && hiddenTalentCount > 0
                    ? `, which reaches ${hiddenTalentCount} candidates the old filter hid`
                    : ''
                }. Nothing is published until a person approves it.`
              : copy.detail}
          </p>
        </div>
        <StatusBadge label="simulated" live={false} />
      </div>

      {copy === null ? null : (
        <div className="mt-6 flex flex-wrap items-center gap-4" role="status">
          <StatusBadge tone={copy.tone} label={copy.label} />
          <p className={`${metaClass} ${smokeClass}`}>
            {`${formatTime(decision.decided_at)} · ${decision.decision_id}`}
          </p>
        </div>
      )}

      {showForm ? (
        <div className="mt-8 flex flex-col items-start gap-6 sm:flex-row sm:items-end">
          <Field id={`reviewer-${jobPostId}`} label="Signed by" className="w-full sm:w-64">
            <TextInput
              id={`reviewer-${jobPostId}`}
              value={reviewer}
              onChange={(event) => setReviewer(event.target.value)}
              disabled={isSaving}
              maxLength={80}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="glossy"
              onClick={() => decide('approve')}
              disabled={isSaving || isLoading}
              aria-busy={isSaving}
            >
              Approve rewrite
            </Button>
            <Button
              variant="ghost"
              onClick={() => decide('reject')}
              disabled={isSaving || isLoading}
            >
              Reject
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <Button variant="ghost" onClick={() => setIsChanging(true)}>
            Change decision
          </Button>
        </div>
      )}

      {error === '' ? null : (
        <p role="alert" className={`mt-4 ${bodyCopyClass} ${chalkClass}`}>
          {error}
        </p>
      )}

      <div className={`mt-6 ${metaRowClass}`}>
        <span>Simulated job post</span>
        <span aria-hidden="true">·</span>
        <span>A reversal is recorded as a new decision; the first stays on record.</span>
      </div>
    </div>
  )
}
