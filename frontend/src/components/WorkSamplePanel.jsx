import { useState } from 'react'
import { scoreWorkSample } from '../api.js'
import {
  bodyClass,
  bodyCopyClass,
  chalkClass,
  controlFieldLabelClass,
  headingSmClass,
  metaClass,
  readingClass,
  ruleClass,
  sectionHeadingClass,
} from '../styles/classes.js'
import { Button } from './Button.jsx'
import Field from './Field.jsx'
import Select from './Select.jsx'
import StatusBadge from './StatusBadge.jsx'
import Textarea from './Textarea.jsx'

const EMPTY_SKILLS = []

// Moved out of WorkerApp unchanged in behaviour: the intake panel now lives in
// step 01 of the demo and this form in step 02, beside the bug hunt it
// complements. The passport it reads comes down from App instead of from the
// panel's own poll.
const SECTION_CLASS = `border-t ${ruleClass} pt-8`
const ALERT_CLASS = `mt-4 ${readingClass} text-left ${bodyClass} ${chalkClass}`

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'The ReRoute service could not be reached. Try again.'
}

function getSourceLabel(source) {
  if (source === 'live' || source === 'simulated' || source === 'local') {
    return source
  }

  return 'source pending'
}

/**
 * Score free-text evidence for any skill on the passport.
 *
 * @param {{
 *   baseUrl?: string,
 *   sessionId?: string | null,
 *   skills?: { name: string }[],
 *   onScored?: () => void,
 *   title?: string,
 *   description?: string,
 * }} props
 */
export default function WorkSamplePanel({
  baseUrl = '',
  sessionId = null,
  skills = EMPTY_SKILLS,
  onScored,
  title = 'Turn a claim into a credential',
  description = 'Pick one skill from the passport and paste the evidence. The server scores it and decides whether a credential is issued.',
}) {
  const [selectedSkill, setSelectedSkill] = useState('')
  const [submission, setSubmission] = useState('')
  const [sample, setSample] = useState(
    /** @type {{ score: number, credential_issued: boolean, source: string } | null} */ (null),
  )
  const [error, setError] = useState('')
  const [isScoring, setIsScoring] = useState(false)
  const skillNames = skills.map((skill) => skill.name)
  const activeSkill = skillNames.includes(selectedSkill)
    ? selectedSkill
    : (skillNames[0] ?? '')

  async function handleSubmit(event) {
    event.preventDefault()

    if (isScoring || activeSkill === '' || submission.trim() === '') {
      return
    }

    setIsScoring(true)
    setError('')
    setSample(null)

    try {
      setSample(
        await scoreWorkSample(
          {
            skill_id: activeSkill,
            submission: submission.trim(),
            session_id: sessionId,
          },
          { baseUrl },
        ),
      )
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setIsScoring(false)
    }

    onScored?.()
  }

  return (
    <form
      className={SECTION_CLASS}
      onSubmit={handleSubmit}
      data-testid="work-sample-panel"
    >
      <p className={sectionHeadingClass}>Proof · work sample</p>
      <h3 className={`mt-2 ${headingSmClass} ${chalkClass}`}>{title}</h3>
      <p className={`mt-3 ${bodyCopyClass}`}>{description}</p>

      {skills.length === 0 ? (
        <p className={`mt-6 ${bodyCopyClass}`}>
          A skill is needed before a work sample can be scored. The passport
          has not landed yet.
        </p>
      ) : (
        <>
          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            <Field id="worker-sample-skill" label="Skill to prove">
              <Select
                id="worker-sample-skill"
                value={activeSkill}
                onChange={(event) => setSelectedSkill(event.target.value)}
              >
                {skillNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              {/* Not a <label htmlFor>: the score is an output, not a form
                  control, so it is associated with aria-labelledby instead. */}
              <p id="worker-sample-score" className={controlFieldLabelClass}>
                Work sample score
              </p>
              <p
                aria-labelledby="worker-sample-score"
                className={`mt-3 border-b ${ruleClass} pb-2 ${metaClass} ${chalkClass}`}
              >
                {sample === null ? 'No score yet' : `${sample.score} out of 100`}
              </p>
            </div>
          </div>

          <Field
            id="worker-sample-submission"
            label="Evidence submission"
            className="mt-8"
          >
            <Textarea
              id="worker-sample-submission"
              rows={4}
              value={submission}
              onChange={(event) => setSubmission(event.target.value)}
              placeholder="Paste the script, collection or pipeline you built."
            />
          </Field>

          <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Button
              type="submit"
              variant="ghost"
              disabled={isScoring || submission.trim() === ''}
              aria-busy={isScoring}
            >
              {isScoring ? 'Scoring sample…' : 'Score work sample'}
            </Button>

            {sample === null ? null : (
              <StatusBadge
                live={sample.source === 'live'}
                label={getSourceLabel(sample.source)}
              />
            )}
          </div>

          {sample === null ? null : (
            <p className={`mt-4 ${bodyCopyClass}`}>
              {sample.credential_issued
                ? 'Credential issued and recorded on the passport.'
                : 'No credential issued. The score is below the server threshold.'}
            </p>
          )}

          {error === '' ? null : (
            <p className={ALERT_CLASS} role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </form>
  )
}
