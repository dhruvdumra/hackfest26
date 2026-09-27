import { useEffect, useState } from 'react'
import { getRoute } from '../api.js'
import {
  bodyCopyClass,
  chalkClass,
  metaClass,
  sectionHeadingClass,
  smokeClass,
} from '../styles/classes.js'

/* "Why not me?" — the deck's promise that every non-match comes with a reason
 * and the shortest route to qualify.
 *
 * A role can lose for two different reasons, and the answer differs:
 *   - blocked by the wage-scar guardrail: she qualifies, but taking it would
 *     cut her pay, so the answer is the server's own reason and the opt-in —
 *     there is no skill route to offer, because skills were never the problem;
 *   - ranked below the top match: the answer is the score gap and the shortest
 *     skill route to the role, read from GET /route.
 */

const DEFAULT_FROM_SKILL = 'Manual testing'
const DEFAULT_HOURS_PER_WEEK = 10

function toScore(value) {
  return typeof value === 'number' ? Math.round(value * 100) : null
}

/**
 * @param {{
 *   baseUrl?: string,
 *   match: Record<string, any>,
 *   topScore?: number | null,
 *   fromSkill?: string,
 *   hoursPerWeek?: number,
 * }} props
 */
export default function WhyNotMe({
  baseUrl = '',
  match,
  topScore = null,
  fromSkill = DEFAULT_FROM_SKILL,
  hoursPerWeek = DEFAULT_HOURS_PER_WEEK,
}) {
  const isBlocked = match.blocked_by_guardrail === true
  const roleId = String(match.role_id ?? match.role ?? '')
  const [route, setRoute] = useState(
    /** @type {{ state: 'loading' | 'ready' | 'none' | 'error', data?: any }} */ ({
      state: 'loading',
    }),
  )

  useEffect(() => {
    if (isBlocked) {
      return undefined
    }

    const controller = new AbortController()

    getRoute(
      { fromSkill, targetRole: roleId, hoursPerWeek },
      { baseUrl, signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setRoute({ state: 'ready', data })
        }
      })
      .catch((requestError) => {
        if (controller.signal.aborted) {
          return
        }

        // A 422 means the demo skills graph has no route to this role, which is
        // an answer in itself; anything else is a failed request.
        const status = /** @type {{ status?: unknown }} */ (requestError)?.status
        setRoute({ state: status === 422 ? 'none' : 'error' })
      })

    return () => controller.abort()
  }, [baseUrl, fromSkill, hoursPerWeek, isBlocked, roleId])

  const title = match.title ?? roleId
  const score = toScore(match.score)
  const top = toScore(topScore)

  if (isBlocked) {
    return (
      <div className="py-6" data-testid="why-not-me">
        <p className={sectionHeadingClass}>Why not me? · {title}</p>
        <p className={`mt-3 ${bodyCopyClass} ${chalkClass}`}>
          You qualify. It is blocked to protect your pay.
        </p>
        <p className={`mt-2 ${bodyCopyClass}`}>
          {match.guardrail_reason ?? 'The role cuts pay past the wage-scar guardrail.'} Turn
          on “Accept a pay cut” above if you would still take it; nothing is
          hidden, only held back until you choose.
        </p>
      </div>
    )
  }

  const legs = route.state === 'ready' && Array.isArray(route.data?.legs) ? route.data.legs : []
  const newLegs = legs.filter((leg) => typeof leg?.hours === 'number' && leg.hours > 0)

  return (
    <div className="py-6" data-testid="why-not-me" aria-live="polite">
      <p className={sectionHeadingClass}>Why not me? · {title}</p>
      <p className={`mt-3 ${bodyCopyClass} ${chalkClass}`}>
        {score !== null && top !== null && score < top
          ? `Your match is ${score} against ${top} for the top role: fewer of your proven skills line up with this one yet.`
          : 'This role ranks below the ones above it on your proven skills.'}
      </p>

      {route.state === 'loading' ? (
        <p className={`mt-2 ${bodyCopyClass}`} role="status">
          Finding the shortest route to qualify…
        </p>
      ) : route.state === 'none' ? (
        <p className={`mt-2 ${bodyCopyClass}`}>
          The demo skills graph has no route to this role yet, so there is no
          plan to show — only the score above.
        </p>
      ) : route.state === 'error' ? (
        <p className={`mt-2 ${bodyCopyClass}`} role="alert">
          The route could not be loaded. The reason above still stands.
        </p>
      ) : (
        <>
          <p className={`mt-2 ${bodyCopyClass}`}>
            {`Shortest route to qualify: ${route.data.total_hours} hours${
              typeof route.data.weeks === 'number'
                ? `, about ${route.data.weeks} weeks at ${hoursPerWeek} hours a week`
                : ''
            }.`}
          </p>
          {newLegs.length === 0 ? null : (
            <ol className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2" aria-label={`Route to ${title}`}>
              {newLegs.map((leg, index) => (
                <li key={leg.skill} className="flex items-center gap-3">
                  {index === 0 ? null : (
                    <span aria-hidden="true" className="h-px w-6 bg-route" />
                  )}
                  <span className={`${metaClass} ${chalkClass}`}>{leg.skill}</span>
                  <span className={`${metaClass} ${smokeClass}`}>{`${leg.hours} h`}</span>
                </li>
              ))}
            </ol>
          )}
          <p className={`mt-4 ${metaClass} ${smokeClass}`}>
            {`source=${route.data.source ?? 'unknown'} · from ${fromSkill}`}
          </p>
        </>
      )}
    </div>
  )
}
