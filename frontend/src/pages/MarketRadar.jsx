import { useEffect, useRef, useState } from 'react'
import { getDisplacementRadar } from '../api.js'
import { asText, formatErrorMessage } from '../lib/format.js'
import {
  chalkClass,
  dataLabelClass,
  headingSmClass,
  metaClass,
  metaRowClass,
  ruleClass,
} from '../styles/classes.js'
import Button from '../components/Button.jsx'
import Field from '../components/Field.jsx'
import { BlockShell, DisclaimerNote, StatusMessage } from '../components/PanelBlocks.jsx'
import TextInput from '../components/TextInput.jsx'

const KNOWN_RADAR_ROLES = [
  'manual-testing-technician',
  'qa-test-associate',
  'support-operations-lead',
  'data-quality-analyst',
  'qa-analyst',
  'qa-automation-engineer',
  'product-analyst',
  'test-manager',
]

const DEFAULT_RADAR_ROLE = 'qa-analyst'
const DEFAULT_RADAR_CITY = 'Chennai'

function readRadarError(requestError) {
  return formatErrorMessage(
    requestError,
    'The displacement radar could not be read. Try again in a moment.',
  )
}

/**
 * Market Intelligence's displacement radar: how exposed one role is in her
 * city, and whether demand for it is still growing. The pipeline agent reads
 * the same radar from SAP HANA Cloud; this panel queries the bundled sample
 * directly, so its badge says `simulated`.
 */
export default function MarketRadar({ baseUrl = '' }) {
  const [role, setRole] = useState(DEFAULT_RADAR_ROLE)
  const [city, setCity] = useState(DEFAULT_RADAR_CITY)
  const [radar, setRadar] = useState(
    /** @type {{ role?: string, city?: string, exposure?: string, demand?: string, disclaimer?: string } | null} */ (null),
  )
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  // A newer request cancels the older one, so a slow answer never wins.
  const requestRef = useRef(/** @type {AbortController | null} */ (null))

  useEffect(() => () => requestRef.current?.abort(), [])

  useEffect(() => {
    void loadRadar(DEFAULT_RADAR_ROLE, DEFAULT_RADAR_CITY)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount fetch only
  }, [])

  async function loadRadar(nextRole, nextCity) {
    requestRef.current?.abort()

    const controller = new AbortController()
    requestRef.current = controller
    setIsLoading(true)
    setError('')
    setRadar(null)

    try {
      const response = await getDisplacementRadar(
        { role: nextRole, city: nextCity },
        { baseUrl, signal: controller.signal },
      )

      if (requestRef.current === controller) {
        setRadar(response)
      }
    } catch (requestError) {
      if (requestRef.current === controller) {
        setError(readRadarError(requestError))
      }
    } finally {
      if (requestRef.current === controller) {
        setIsLoading(false)
      }
    }
  }

  function handleSubmit(event) {
    event.preventDefault()
    void loadRadar(role.trim() || DEFAULT_RADAR_ROLE, city.trim() || DEFAULT_RADAR_CITY)
  }

  return (
    <BlockShell
      titleId="displacement-radar-title"
      title="Displacement radar"
      description="How exposed one role is in her city, and whether demand for it is still growing."
    >
      <form
        className={`flex flex-col items-start gap-8 border-t ${ruleClass} pt-8 sm:flex-row sm:items-end`}
        onSubmit={handleSubmit}
      >
        <div className="flex-1">
          <Field id="radar-role" label="Role id">
            <TextInput
              id="radar-role"
              name="role"
              list="radar-role-options"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
          </Field>
          <datalist id="radar-role-options">
            {KNOWN_RADAR_ROLES.map((knownRole) => (
              <option key={knownRole} value={knownRole} />
            ))}
          </datalist>
        </div>
        <Field id="radar-city" label="City" className="sm:w-40">
          <TextInput
            id="radar-city"
            name="city"
            value={city}
            onChange={(event) => setCity(event.target.value)}
          />
        </Field>
        <Button
          type="submit"
          variant="glossy"
          arrow="↗"
          disabled={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? 'Loading radar…' : 'Check exposure'}
        </Button>
      </form>

      <div
        className="mt-12"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="radar-region"
      >
        {isLoading ? (
          <StatusMessage
            tone="loading"
            title="Loading radar…"
            message={`Reading the displacement radar for ${role} in ${city}.`}
            testId="radar-loading"
          />
        ) : error ? (
          <StatusMessage tone="error" title="Radar unavailable" message={error} testId="radar-error" />
        ) : !radar ? (
          <StatusMessage
            tone="empty"
            title="No radar row yet"
            message="Pick a role id and city, then check the exposure."
            testId="radar-empty"
          />
        ) : (
          <div>
            <dl className="grid gap-8 sm:grid-cols-2">
              <div className={`border-t ${ruleClass} pt-4`}>
                <dt className={dataLabelClass}>Role</dt>
                <dd className={`mt-2 ${metaClass} ${chalkClass}`}>{asText(radar.role, role)}</dd>
              </div>
              <div className={`border-t ${ruleClass} pt-4`}>
                <dt className={dataLabelClass}>City</dt>
                <dd className={`mt-2 ${metaClass} ${chalkClass}`}>{asText(radar.city, city)}</dd>
              </div>
              <div className={`border-t ${ruleClass} pt-4`}>
                <dt className={dataLabelClass}>Displacement exposure</dt>
                <dd className={`mt-2 ${headingSmClass} ${chalkClass}`} data-testid="radar-exposure">
                  {asText(radar.exposure, 'unknown')}
                </dd>
              </div>
              <div className={`border-t ${ruleClass} pt-4`}>
                <dt className={dataLabelClass}>Local demand</dt>
                <dd className={`mt-2 ${headingSmClass} ${chalkClass}`} data-testid="radar-demand">
                  {asText(radar.demand, 'unknown')}
                </dd>
              </div>
            </dl>
            <div className={`mt-8 ${metaRowClass}`}>
              <span>source=simulated</span>
              <span aria-hidden="true">·</span>
              <span>Demo market fixture</span>
            </div>
            <DisclaimerNote disclaimer={radar.disclaimer} scope="Displacement radar" />
          </div>
        )}
      </div>
    </BlockShell>
  )
}
