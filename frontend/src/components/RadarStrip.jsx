import { useEffect, useState } from 'react'
import { getDisplacementRadar } from '../api.js'
import {
  bodyCopyClass,
  chalkClass,
  metaClass,
  ruleClass,
  sectionHeadingClass,
  smokeClass,
} from '../styles/classes.js'
import { Button } from './Button.jsx'
import StatusBadge from './StatusBadge.jsx'

/* The displacement radar as one line: where Kavya is, and where she is going.
 *
 * The full radar block (a role/city form, a 2×2 grid and two disclaimers) took
 * a screen of its own in the route step, so the presenter scrolled past it to
 * reach the route. The demo needs one comparison from it — her current role
 * is being automated away, the target role is growing — so the strip reads the
 * two radar rows and states exactly that. The data and its `simulated` label
 * are unchanged. */

const FROM = { role: 'manual-testing-technician', label: 'Manual testing technician' }
const TO = { role: 'qa-analyst', label: 'QA analyst' }
const CITY = 'Chennai'

function getErrorMessage(error) {
  return error instanceof Error && error.message
    ? error.message
    : 'The displacement radar could not be read.'
}

function Reading({ label, row }) {
  return (
    <div className="min-w-0">
      <p className={`${metaClass} ${smokeClass}`}>{label}</p>
      <p className={`mt-1 ${bodyCopyClass} ${chalkClass}`}>
        {row === null ? '—' : `Exposure ${row.exposure} · demand ${row.demand}`}
      </p>
    </div>
  )
}

/** @param {{ baseUrl?: string }} props */
export default function RadarStrip({ baseUrl = '' }) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(
    /** @type {{ attempt: number, rows: any[] | null, error: string }} */ ({
      attempt: -1,
      rows: null,
      error: '',
    }),
  )
  const isLoading = result.attempt !== attempt
  const [from, to] = result.rows ?? [null, null]

  useEffect(() => {
    const controller = new AbortController()
    const options = { baseUrl, signal: controller.signal }

    Promise.all([
      getDisplacementRadar({ role: FROM.role, city: CITY }, options),
      getDisplacementRadar({ role: TO.role, city: CITY }, options),
    ])
      .then((rows) => {
        if (!controller.signal.aborted) {
          setResult({ attempt, rows, error: '' })
        }
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          setResult({ attempt, rows: null, error: getErrorMessage(requestError) })
        }
      })

    return () => controller.abort()
  }, [attempt, baseUrl])

  return (
    <section
      aria-labelledby="radar-strip-title"
      aria-busy={isLoading}
      data-testid="radar-strip"
      className={`border-t ${ruleClass} pt-6`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="radar-strip-title" className={sectionHeadingClass}>
          {`Displacement radar · ${CITY}`}
        </p>
        <StatusBadge label="simulated" live={false} />
      </div>

      {result.error !== '' && !isLoading ? (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-4">
          <p className={bodyCopyClass}>{result.error}</p>
          <Button variant="ghost" onClick={() => setAttempt((current) => current + 1)}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="mt-4 grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-8">
          <Reading label={`Today · ${FROM.label}`} row={from} />
          <span aria-hidden="true" className="hidden h-px w-16 bg-route sm:block" />
          <Reading label={`Target · ${TO.label}`} row={to} />
        </div>
      )}
    </section>
  )
}
