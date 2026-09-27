import { useEffect, useState } from 'react'
import { runMatch } from '../api.js'
import { isAbortError } from '../lib/guards.js'
import {
  bodyClass,
  bodyCopyClass,
  chalkClass,
  dataLabelClass,
  headingSmClass,
  inlineLabelClass,
  metaClass,
  metaRowClass,
  ruleClass,
  sectionHeadingClass,
  smokeClass,
} from '../styles/classes.js'
import StatusBadge from './StatusBadge.jsx'
import Switch from './Switch.jsx'
import { Button } from './Button.jsx'

/* Inclusive Matching, with the Wage-Scar Guardrail on screen.
 *
 * The API has always ranked every role and marked the ones that cut pay past
 * the guardrail, but no panel ever called it, so the guardrail — "refuses
 * routes that cut pay" on the deck's comparison slide — was invisible in the
 * demo. This panel ranks Kavya's passport, keeps the blocked roles in view
 * with the server's own reason, and lets her opt in to a pay cut, which is the
 * one condition under which the server lifts the block. */

// Without a session the server matches its baseline manual-tester passport,
// which is Kavya's starting point, so the panel still has something honest to
// show before Run pipeline is pressed.
const BASELINE_PASSPORT_ID = 'kavya-baseline'

// The allowed roles a presenter talks through, before the rest fold away. The
// blocked roles are always shown: they are the reason the panel exists.
const VISIBLE_ALLOWED = 5

const FOCUS_RING_CLASS = 'focus:outline-2 focus:outline-offset-2 focus:outline-ash'
const CELL_CLASS = `px-4 py-4 ${metaClass}`

function formatPercent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—'
  }

  const rounded = Math.round(value * 10) / 10

  return rounded > 0 ? `+${rounded}%` : `${rounded}%`
}

function formatScore(value) {
  return typeof value === 'number' ? String(Math.round(value * 100)) : '—'
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'The matching service could not be reached. Try again.'
}

/**
 * @param {{
 *   baseUrl?: string,
 *   sessionId?: string | null,
 *   passportId?: string | null,
 *   renderWhyNotMe?: (match: Record<string, any>) => import('react').ReactNode,
 * }} props
 */
export default function MatchPanel({
  baseUrl = '',
  sessionId = null,
  passportId = null,
  renderWhyNotMe,
}) {
  const [acceptPayCut, setAcceptPayCut] = useState(false)
  const [showAll, setShowAll] = useState(false)
  // A session only matches its own passport once the skills agent has written
  // one; until then the server's baseline stands in.
  const usesSession = Boolean(sessionId) && Boolean(passportId)
  const payload = {
    passport_id: usesSession ? passportId : BASELINE_PASSPORT_ID,
    session_id: usesSession ? sessionId : null,
    constraints: { accept_pay_cut: acceptPayCut },
  }
  // One key per distinct request. The panel is loading until the settled
  // outcome carries the current key, so no state is set synchronously in the
  // effect and a superseded response can never be mistaken for the current one.
  const requestKey = JSON.stringify([baseUrl, payload])
  const [outcome, setOutcome] = useState(
    /** @type {{ key: string | null, response: any, error: string }} */ ({
      key: null,
      response: null,
      error: '',
    }),
  )
  const isLoading = outcome.key !== requestKey
  const response = outcome.response
  const error = isLoading ? '' : outcome.error

  useEffect(() => {
    const controller = new AbortController()
    const request = JSON.parse(requestKey)[1]

    runMatch(request, { baseUrl, signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) {
          setOutcome({ key: requestKey, response: next, error: '' })
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted && !isAbortError(requestError)) {
          setOutcome({ key: requestKey, response: null, error: getErrorMessage(requestError) })
        }
      })

    return () => controller.abort()
  }, [baseUrl, requestKey])

  const matches = Array.isArray(response?.matches) ? response.matches : []
  const blocked = matches.filter((match) => match.blocked_by_guardrail)
  const allowed = matches.filter((match) => !match.blocked_by_guardrail)
  const visibleAllowed = showAll ? allowed : allowed.slice(0, VISIBLE_ALLOWED)
  const hiddenCount = allowed.length - visibleAllowed.length
  const rows = [...visibleAllowed, ...blocked]
  const threshold = response?.guardrail_threshold_pct ?? 15

  return (
    <section
      aria-labelledby="match-panel-title"
      aria-busy={isLoading}
      className={`border-t ${ruleClass} pt-8`}
      data-testid="match-panel"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={sectionHeadingClass}>Inclusive matching</p>
          <h3 id="match-panel-title" className={`mt-2 ${headingSmClass} ${chalkClass}`}>
            Roles she can take — and the ones she should not.
          </h3>
          <p className={`mt-3 ${bodyCopyClass}`}>
            Ranked on proven skills and her constraints. Any role that cuts her
            pay by more than {threshold}% is blocked unless she opts in.
          </p>
        </div>
        <StatusBadge
          live={response?.source === 'live'}
          label={response?.source ?? 'no run yet'}
        />
      </div>

      <div className="mt-8 flex flex-col items-start gap-4 border-t border-graphite pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Switch
          id="accept-pay-cut"
          checked={acceptPayCut}
          onChange={(event) => setAcceptPayCut(event.target.checked)}
          disabled={isLoading}
          label="Accept a pay cut"
          description="Kavya's opt-in. Off by default, so the guardrail protects her."
        />
        <p className={`${metaClass} ${smokeClass}`} aria-live="polite">
          {response === null
            ? isLoading
              ? 'Ranking roles…'
              : ''
            : `${matches.length} roles ranked · ${blocked.length} blocked · guardrail ${threshold}%`}
        </p>
      </div>

      {error !== '' ? (
        <div role="alert" className="py-12">
          <p className={sectionHeadingClass}>Matching unavailable</p>
          <p className={`mt-3 ${bodyCopyClass}`}>{error}</p>
        </div>
      ) : response === null ? (
        <p className={`py-12 ${bodyCopyClass}`} role="status">
          {isLoading ? 'Ranking roles against the passport…' : 'No ranking yet.'}
        </p>
      ) : (
        <>
          <div
            role="region"
            tabIndex={0}
            aria-label="Scrollable role ranking"
            className={`mt-8 w-full overflow-x-auto ${FOCUS_RING_CLASS}`}
          >
            <table className="w-full min-w-[40rem] text-left">
              <caption className="sr-only">
                Roles ranked for Kavya, with the wage-scar guardrail applied
              </caption>
              <thead className={`border-b ${ruleClass}`}>
                <tr>
                  <th scope="col" className={`py-3 pr-4 ${dataLabelClass}`}>Role</th>
                  <th scope="col" className={`px-4 py-3 ${dataLabelClass}`}>Match</th>
                  <th scope="col" className={`px-4 py-3 ${dataLabelClass}`}>Pay change</th>
                  <th scope="col" className={`px-4 py-3 ${dataLabelClass}`}>Commute</th>
                  <th scope="col" className={`py-3 pl-4 ${dataLabelClass}`}>Guardrail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-graphite">
                {rows.map((match) => {
                  const isBlocked = match.blocked_by_guardrail === true

                  return (
                    <tr key={match.role_id ?? match.role} data-blocked={isBlocked || undefined}>
                      <th scope="row" className="py-4 pr-4 font-normal">
                        <span className={`block ${inlineLabelClass}`}>
                          {match.title ?? match.role}
                        </span>
                        <span className={`mt-1 block ${metaClass} ${smokeClass}`}>
                          {match.role_id ?? match.role}
                        </span>
                      </th>
                      <td className={`${CELL_CLASS} ${chalkClass}`}>{formatScore(match.score)}</td>
                      <td className={`${CELL_CLASS} ${isBlocked ? 'text-danger' : chalkClass}`}>
                        {formatPercent(match.pay_delta_pct)}
                      </td>
                      <td className={`${CELL_CLASS} ${smokeClass}`}>
                        {typeof match.commute_km === 'number' ? `${match.commute_km} km` : '—'}
                      </td>
                      <td className="py-4 pl-4 align-top">
                        {isBlocked ? (
                          <>
                            <StatusBadge tone="danger" label="Blocked" />
                            <p className={`mt-2 max-w-[18rem] ${bodyClass} text-sm ${smokeClass}`}>
                              {match.guardrail_reason ?? 'Blocked by the wage-scar guardrail.'}
                            </p>
                          </>
                        ) : (
                          <StatusBadge tone="muted" label="Allowed" />
                        )}
                        {renderWhyNotMe === undefined ? null : (
                          <div className="mt-3">{renderWhyNotMe(match)}</div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className={`mt-6 ${metaRowClass}`}>
            <span>{`source=${response.source ?? 'unknown'}`}</span>
            <span aria-hidden="true">·</span>
            <span>
              {usesSession ? `passport ${passportId}` : 'baseline passport · no session yet'}
            </span>
            {hiddenCount > 0 || showAll ? (
              <>
                <span aria-hidden="true">·</span>
                <Button variant="ghost" onClick={() => setShowAll((current) => !current)}>
                  {showAll ? 'Show fewer roles' : `Show ${hiddenCount} more roles`}
                </Button>
              </>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
