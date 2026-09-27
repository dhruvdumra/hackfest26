import { useState } from 'react'
import { scoreWorkSample } from '../api.js'
import {
  BUG_HUNT_SKILL_ID,
  PLANTED_BUG_COUNT,
  RECORDED_FINDINGS,
  calculateEmi,
  formatRupees,
  toFinding,
} from '../domain/emiCalculator.js'
import {
  bodyCopyClass,
  chalkClass,
  dataLabelClass,
  headingClass,
  headingSmClass,
  metaClass,
  metaRowClass,
  ruleClass,
  sectionHeadingClass,
  smokeClass,
} from '../styles/classes.js'
import { describeSource } from '../lib/sourceLabel.js'
import { Button } from './Button.jsx'
import Field from './Field.jsx'
import NumberInput from './NumberInput.jsx'
import Select from './Select.jsx'
import StatusBadge from './StatusBadge.jsx'
import Textarea from './Textarea.jsx'

/* Proof of skill: the 15-minute bug hunt from the pitch deck.
 *
 * Kavya is handed a loan-EMI calculator with five planted bugs. She tries
 * inputs; when something looks wrong she logs it, and the finding carries the
 * exact inputs that reproduce it. The server re-runs every reproduction
 * against the same planted bugs and scores the report — found bugs earn
 * points, reports that reproduce nothing cost points — so the credential is
 * earned by evidence, not by a word count. */

const INITIAL_INPUTS = { principal: '500000', annualRate: '9', tenure: '60', tenureUnit: 'months' }
const MIN_NOTE_LENGTH = 3

/** @returns {import('../domain/emiCalculator.js').EmiInputs} */
function toInputs(form) {
  return {
    principal: Number.parseFloat(form.principal),
    annualRate: Number.parseFloat(form.annualRate),
    tenure: Number.parseFloat(form.tenure),
    tenureUnit: form.tenureUnit === 'years' ? 'years' : 'months',
  }
}

function describeFinding(finding) {
  const unit = finding.tenure_unit === 'years' ? 'years' : 'months'

  return `₹${Number(finding.principal).toLocaleString('en-IN')} · ${finding.annual_rate}% · ${finding.tenure} ${unit}`
}

function getErrorMessage(error) {
  return error instanceof Error && error.message
    ? error.message
    : 'The bug report could not be scored. Try again.'
}

/**
 * @param {{ baseUrl?: string, sessionId?: string | null, onScored?: () => void }} props
 */
export default function EmiBugHunt({ baseUrl = '', sessionId = null, onScored }) {
  const [form, setForm] = useState(INITIAL_INPUTS)
  const [note, setNote] = useState('')
  const [findings, setFindings] = useState(/** @type {ReturnType<typeof toFinding>[]} */ ([]))
  const [result, setResult] = useState(/** @type {any} */ (null))
  const [error, setError] = useState('')
  const [isScoring, setIsScoring] = useState(false)
  const inputs = toInputs(form)
  const output = calculateEmi(inputs)
  const canLog = note.trim().length >= MIN_NOTE_LENGTH && findings.length < 25

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function logFinding(event) {
    event.preventDefault()

    if (!canLog) {
      return
    }

    setFindings((current) => [...current, toFinding(inputs, note)])
    setNote('')
    setResult(null)
  }

  function loadRecordedHunt() {
    setFindings(RECORDED_FINDINGS)
    setResult(null)
    setError('')
  }

  async function submitReport() {
    if (isScoring || findings.length === 0) {
      return
    }

    setIsScoring(true)
    setError('')

    try {
      const scored = await scoreWorkSample(
        {
          skill_id: BUG_HUNT_SKILL_ID,
          submission: JSON.stringify({ sample: BUG_HUNT_SKILL_ID, findings }),
          session_id: sessionId,
        },
        { baseUrl },
      )
      setResult(scored)
      onScored?.()
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsScoring(false)
    }
  }

  const bugsFound = Array.isArray(result?.bugs_found) ? result.bugs_found : []
  const bugsTotal = typeof result?.bugs_total === 'number' ? result.bugs_total : PLANTED_BUG_COUNT

  return (
    <section
      aria-labelledby="bug-hunt-title"
      data-testid="emi-bug-hunt"
      className={`border-t ${ruleClass} pt-8`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className={sectionHeadingClass}>Work sample · 15 minutes</p>
          <h3 id="bug-hunt-title" className={`mt-2 ${headingSmClass} ${chalkClass}`}>
            Bug hunt: the EMI calculator.
          </h3>
          <p className={`mt-3 ${bodyCopyClass}`}>
            {`${PLANTED_BUG_COUNT} bugs are planted in this loan calculator. Try inputs, and log each thing that looks wrong — the inputs you log are the reproduction the server re-runs.`}
          </p>
        </div>
        <StatusBadge label="graded locally" live={false} />
      </div>

      <div className="mt-10 grid gap-12 lg:grid-cols-2">
        <div>
          <p className={sectionHeadingClass}>Loan EMI calculator</p>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <Field id="emi-principal" label="Loan amount (₹)">
              <NumberInput
                id="emi-principal"
                step="1000"
                value={form.principal}
                onChange={(event) => update('principal', event.target.value)}
              />
            </Field>
            <Field id="emi-rate" label="Interest rate (% a year)">
              <NumberInput
                id="emi-rate"
                step="0.1"
                value={form.annualRate}
                onChange={(event) => update('annualRate', event.target.value)}
              />
            </Field>
            <Field id="emi-tenure" label="Tenure">
              <NumberInput
                id="emi-tenure"
                min="1"
                step="1"
                value={form.tenure}
                onChange={(event) => update('tenure', event.target.value)}
              />
            </Field>
            <Field id="emi-tenure-unit" label="Tenure in">
              <Select
                id="emi-tenure-unit"
                value={form.tenureUnit}
                onChange={(event) => update('tenureUnit', event.target.value)}
              >
                <option value="months">months</option>
                <option value="years">years</option>
              </Select>
            </Field>
          </div>

          <div className={`mt-8 border-t ${ruleClass} pt-6`} aria-live="polite">
            {output.error !== null ? (
              <p className={`${bodyCopyClass} ${chalkClass}`} role="status">
                {output.error}
              </p>
            ) : (
              <dl className="grid grid-cols-3 gap-4">
                <div>
                  <dt className={dataLabelClass}>Monthly EMI</dt>
                  <dd className={`mt-2 ${headingSmClass} ${chalkClass}`} data-testid="emi-value">
                    {formatRupees(output.emi, inputs.principal)}
                  </dd>
                </div>
                <div>
                  <dt className={dataLabelClass}>Total interest</dt>
                  <dd className={`mt-2 ${metaClass} ${chalkClass}`}>
                    {formatRupees(output.totalInterest, inputs.principal)}
                  </dd>
                </div>
                <div>
                  <dt className={dataLabelClass}>Total payment</dt>
                  <dd className={`mt-2 ${metaClass} ${chalkClass}`}>
                    {formatRupees(output.totalPayment, inputs.principal)}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </div>

        <div>
          <form onSubmit={logFinding}>
            <Field id="emi-note" label="What looks wrong with these inputs?">
              <Textarea
                id="emi-note"
                rows={3}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. 8.5% gives the same EMI as 8%."
              />
            </Field>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="submit" variant="ghost" disabled={!canLog}>
                Log this bug
              </Button>
              <Button variant="ghost" onClick={loadRecordedHunt} disabled={isScoring}>
                Load a recorded hunt
              </Button>
            </div>
          </form>

          <p className={`mt-8 ${sectionHeadingClass}`}>{`Bug report · ${findings.length} logged`}</p>
          {findings.length === 0 ? (
            <p className={`mt-3 ${bodyCopyClass}`}>
              Nothing logged yet. Each entry keeps the inputs on screen when you log it.
            </p>
          ) : (
            <ol className="mt-3 space-y-3" aria-label="Logged bugs">
              {findings.map((finding, index) => (
                <li
                  key={`${index}-${finding.note}`}
                  className={`flex items-start justify-between gap-4 border-t ${ruleClass} pt-3`}
                >
                  <div className="min-w-0">
                    <p className={`${metaClass} ${chalkClass}`}>{describeFinding(finding)}</p>
                    <p className={`mt-1 ${bodyCopyClass}`}>{finding.note}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setFindings((current) => current.filter((_, position) => position !== index))
                      setResult(null)
                    }}
                    aria-label={`Remove finding ${index + 1}`}
                    className={`shrink-0 underline decoration-iron underline-offset-4 hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ash ${metaClass} ${smokeClass}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-8">
            <Button
              variant="glossy"
              onClick={submitReport}
              disabled={isScoring || findings.length === 0}
              aria-busy={isScoring}
            >
              {isScoring ? 'Scoring the report…' : 'Submit bug report'}
            </Button>
          </div>
        </div>
      </div>

      {error === '' ? null : (
        <p role="alert" className={`mt-8 ${bodyCopyClass} ${chalkClass}`}>
          {error}
        </p>
      )}

      {result === null ? null : (
        <div className={`mt-12 border-t ${ruleClass} pt-8`} role="status" data-testid="bug-hunt-result">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className={sectionHeadingClass}>Scored by the server</p>
              <p className={`mt-3 ${headingClass} ${chalkClass}`}>{`${result.score} / 100`}</p>
              <p className={`mt-2 ${bodyCopyClass}`}>
                {`${bugsFound.length} of ${bugsTotal} planted bugs reproduced · ${result.false_reports ?? 0} false ${result.false_reports === 1 ? 'report' : 'reports'}`}
              </p>
            </div>
            <StatusBadge
              tone={result.credential_issued ? 'accent' : 'muted'}
              label={
                result.credential_issued
                  ? `Credential · ${result.credential ?? 'issued'}`
                  : 'No credential yet'
              }
            />
          </div>
          {bugsFound.length === 0 ? null : (
            <ul className="mt-6 grid gap-2 sm:grid-cols-2" aria-label="Bugs reproduced">
              {bugsFound.map((title) => (
                <li key={title} className={`${metaClass} ${chalkClass}`}>
                  <span aria-hidden="true" className="mr-2 text-pulse-green">✓</span>
                  {title}
                </li>
              ))}
            </ul>
          )}
          <p className={`mt-6 ${bodyCopyClass}`}>
            {result.credential_issued
              ? sessionId
                ? 'The credential is on Kavya’s Skill Passport in step 01.'
                : 'Scored, but there is no session to record the credential on. Press Run pipeline first.'
              : `Below the credential threshold. ${bugsTotal - bugsFound.length} planted ${bugsTotal - bugsFound.length === 1 ? 'bug is' : 'bugs are'} still hidden.`}
          </p>
          <div className={`mt-6 ${metaRowClass}`}>
            <span>{describeSource(result.source)}</span>
            <span aria-hidden="true">·</span>
            <span>Each reproduction re-run against the planted bugs; no model involved.</span>
          </div>
        </div>
      )}
    </section>
  )
}
