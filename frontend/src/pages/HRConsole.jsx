import { useEffect, useRef, useState } from 'react'
import {
  decideEmployerRewrite,
  getEmployerDecision,
  rewriteEmployerFilter,
} from '../api.js'
import { asCount, asList, asText, formatErrorMessage } from '../lib/format.js'
import {
  bodyClass,
  bodyCopyClass,
  chalkClass,
  controlFieldHintClass,
  dataLabelClass,
  headingClass,
  headingSmClass,
  metaClass,
  metaRowClass,
  ruleClass,
  noteClass,
  sectionHeadingClass,
  smokeClass,
} from '../styles/classes.js'
import Button from '../components/Button.jsx'
import Field from '../components/Field.jsx'
import Select from '../components/Select.jsx'
import { BlockShell, DisclaimerNote, StatusMessage } from '../components/PanelBlocks.jsx'

const KNOWN_JOB_POST_IDS = [
  'post-chennai-qa-analyst-118',
  'post-chennai-support-lead-207',
  'post-chennai-data-quality-311',
]

const DEFAULT_JOB_POST_ID = KNOWN_JOB_POST_IDS[0]
const EMPTY_RESULT = null

function readRewriteError(requestError) {
  return formatErrorMessage(
    requestError,
    'The employer rewrite could not be read. Check the backend is running.',
  )
}

function FilterPanel({ heading, headingId, text, children }) {
  return (
    <div className={`border-t ${ruleClass} pt-6`}>
      <h3 id={headingId} className={sectionHeadingClass}>
        {heading}
      </h3>
      <p className={`mt-3 ${bodyCopyClass}`}>{text}</p>
      {children}
    </div>
  )
}

function formatDecisionTime(decidedAt) {
  const parsed = new Date(decidedAt)

  return Number.isNaN(parsed.getTime())
    ? ''
    : parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * The human gate on the employer side: nothing ReRoute rewrites is published
 * until a hiring manager signs it off. The decision is recorded by the backend
 * (`source=local`), not by an ATS.
 *
 * A decision read back from an earlier visit (a rehearsal, or the SAP Build
 * Apps screen) is shown as one line above the buttons rather than replacing
 * them, so the manager can always decide again; the backend keeps every
 * decision and answers with the latest.
 */
function SignOffBlock({ decision, priorDecision, error, isDeciding, onDecide, onDecideAgain }) {
  return (
    <div className={`mt-12 border-t ${ruleClass} pt-8`}>
      <h3 className={sectionHeadingClass}>Hiring manager sign-off</h3>
      {decision ? (
        <>
          <p
            className={`mt-3 ${headingSmClass} ${chalkClass}`}
            data-testid="rewrite-decision"
            role="status"
          >
            {asText(decision.message, 'Decision recorded')}
          </p>
          <div className={`mt-4 ${metaRowClass}`}>
            <span>{`decision=${asText(decision.decision, 'recorded')}`}</span>
            <span aria-hidden="true">·</span>
            <span>source=local</span>
            {formatDecisionTime(decision.decided_at) === '' ? null : (
              <>
                <span aria-hidden="true">·</span>
                <span>{formatDecisionTime(decision.decided_at)}</span>
              </>
            )}
          </div>
          <Button type="button" variant="ghost" className="mt-6" onClick={onDecideAgain}>
            Decide again
          </Button>
        </>
      ) : (
        <>
          {priorDecision ? (
            <div className={`mt-3 ${metaRowClass}`} data-testid="rewrite-prior-decision">
              <span>{`Last recorded decision=${asText(priorDecision.decision, 'recorded')}`}</span>
              {formatDecisionTime(priorDecision.decided_at) === '' ? null : (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{formatDecisionTime(priorDecision.decided_at)}</span>
                </>
              )}
            </div>
          ) : null}
          <p className={`mt-3 ${bodyCopyClass}`}>
            Nothing is published until a person signs it off. Approve to publish
            the rewritten post, or reject it and the rewrite stays unpublished.
          </p>
          <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="glossy"
              arrow="↗"
              onClick={() => onDecide(true)}
              disabled={isDeciding}
              aria-busy={isDeciding}
            >
              Approve and publish
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onDecide(false)}
              disabled={isDeciding}
            >
              Reject
            </Button>
          </div>
          {error === '' ? null : (
            <p
              className={`mt-4 max-w-[40rem] text-left ${bodyClass} ${chalkClass}`}
              data-testid="rewrite-decision-error"
              role="alert"
            >
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function RewriteBlock({
  jobPostId,
  isLoading,
  error,
  rewrite,
  className = '',
  onJobPostChange,
  onSubmit,
  decision,
  priorDecision,
  decisionError,
  isDeciding,
  onDecide,
  onDecideAgain,
}) {
  const hiddenTalentCount = rewrite ? asCount(rewrite.hidden_talent_count) : null
  const removedCriteria = rewrite ? asList(rewrite.removed_criteria) : []
  const noHiddenTalent = Boolean(rewrite) && hiddenTalentCount === 0

  return (
    <BlockShell
      titleId="employer-rewrite-title"
      title="Job post filter rewrite"
      description="The restrictive phrase an employer wrote, the criteria ReRoute drops, and the wording that replaces them."
      className={className}
    >
      <form
        className={`flex flex-col items-start gap-8 border-t ${ruleClass} pt-8 sm:flex-row sm:items-end`}
        onSubmit={onSubmit}
      >
        <div className="flex-1">
          <Field id="job-post-id" label="Job post id">
            <Select
              id="job-post-id"
              name="job_post_id"
              value={jobPostId}
              onChange={onJobPostChange}
            >
              {KNOWN_JOB_POST_IDS.map((knownId) => (
                <option key={knownId} value={knownId}>
                  {knownId}
                </option>
              ))}
            </Select>
          </Field>
          <p className={controlFieldHintClass}>
            The demo bundles three job posts and exposes no listing endpoint, so
            these ids are the whole catalogue.
          </p>
        </div>
        <Button
          type="submit"
          variant="glossy"
          arrow="↗"
          disabled={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? 'Rewriting…' : 'Rewrite this post'}
        </Button>
      </form>

      <div
        className="mt-12"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="rewrite-region"
      >
        {isLoading ? (
          <StatusMessage
            tone="loading"
            title="Rewriting the filter…"
            message={`Simulating a rewrite for ${jobPostId}.`}
            testId="rewrite-loading"
          />
        ) : error ? (
          <StatusMessage
            tone="error"
            title="Rewrite unavailable"
            message={error}
            testId="rewrite-error"
          />
        ) : !rewrite ? (
          <StatusMessage
            tone="empty"
            title="No rewrite yet"
            message="Choose a bundled job post and rewrite it to see how many candidates the restrictive phrase had hidden."
            testId="rewrite-empty"
          />
        ) : (
          <div>
            <div className={`flex flex-col gap-6 border-t ${ruleClass} pt-8 sm:flex-row sm:items-start sm:justify-between`}>
              <div>
                <p className={sectionHeadingClass}>Hidden by this filter</p>
                {/* The block's one hero figure, at the heading size. It stays a
                    number the reader has to parse, not display typography. */}
                <p
                  className={`mt-3 ${headingClass} ${chalkClass}`}
                  data-testid="hidden-talent-count"
                >
                  {hiddenTalentCount === null ? '—' : hiddenTalentCount}
                </p>
                <p className={`mt-4 ${bodyCopyClass}`}>
                  {noHiddenTalent
                    ? 'No candidates were hidden by this post, so there is nothing to rewrite.'
                    : 'Candidates this phrasing never reached, in the bundled demo data.'}
                </p>
              </div>
              <dl className="sm:text-right">
                <div>
                  <dt className={dataLabelClass}>Role</dt>
                  <dd className={`mt-2 ${metaClass} ${chalkClass}`}>
                    {asText(rewrite.role, 'unknown role')}
                  </dd>
                </div>
                <div className="mt-4">
                  <dt className={dataLabelClass}>City</dt>
                  <dd className={`mt-2 ${metaClass} ${chalkClass}`}>
                    {asText(rewrite.city, 'unknown city')}
                  </dd>
                </div>
              </dl>
            </div>

            <div className={`mt-12 flex flex-col gap-3 border-t ${ruleClass} pt-8 sm:flex-row sm:items-center`}>
              {/* The words and the hairline do the work an arrow used to: the
                  "·" is the same separator the meta rows use. */}
              <p className={sectionHeadingClass}>Flagged · rewritten</p>
              <span
                aria-hidden="true"
                className={`hidden h-px flex-1 bg-graphite sm:block`}
              />
              <p
                className={`${bodyCopyClass}`}
                data-testid="rewrite-reason"
              >
                {asText(
                  rewrite.rewrite_reason,
                  'No rewrite reason supplied by the demo fixture.',
                )}
              </p>
            </div>

            <div className="mt-12 grid gap-8 lg:grid-cols-2">
              <FilterPanel
                heading="Before · would be flagged"
                headingId="filter-text-before"
                text={asText(
                  rewrite.filter_text_before,
                  'No before text supplied.',
                )}
              >
                <p className={`mt-4 border-t ${ruleClass} pt-4`}>
                  <span className={`block ${dataLabelClass}`}>
                    Restrictive phrase removed
                  </span>
                  <q
                    className={`mt-2 block text-left italic ${headingSmClass} ${chalkClass}`}
                    data-testid="restrictive-phrase"
                  >
                    {asText(rewrite.restrictive_phrase, 'no phrase reported')}
                  </q>
                </p>
              </FilterPanel>

              <FilterPanel
                heading="After · rewritten post"
                headingId="filter-text-after"
                text={asText(rewrite.filter_text_after, 'No after text supplied.')}
              >
                <p className={`mt-4 border-t ${ruleClass} pt-4`}>
                  <span className={`block ${dataLabelClass}`}>
                    Pedigree wording gone
                  </span>
                  <span className={`mt-2 block ${bodyCopyClass}`}>
                    {noHiddenTalent
                      ? 'The post was already free of restrictive criteria.'
                      : 'The restrictive phrase and its sibling criteria are gone, replaced by evidence every applicant can show.'}
                  </span>
                </p>
              </FilterPanel>

              <p
                className={`lg:col-span-2 ${sectionHeadingClass}`}
              >
                Read top to bottom: the before wording is what an audit flags,
                the after wording is what the employer posts instead.
              </p>
            </div>

            {noHiddenTalent ? null : (
              <SignOffBlock
                decision={decision}
                priorDecision={priorDecision}
                error={decisionError}
                isDeciding={isDeciding}
                onDecide={(approved) =>
                  onDecide(asText(rewrite.job_post_id, jobPostId), approved)
                }
                onDecideAgain={onDecideAgain}
              />
            )}

            <div className={`mt-12 border-t ${ruleClass} pt-8`}>
              <h3 id="removed-criteria-title" className={sectionHeadingClass}>
                Criteria removed ({removedCriteria.length})
              </h3>
              {removedCriteria.length > 0 ? (
                <ul
                  aria-labelledby="removed-criteria-title"
                  className="mt-4 grid gap-3 sm:grid-cols-2"
                >
                  {/* A hairline-separated list, nothing more: the words already
                      say what was dropped, so there is no marker glyph. */}
                  {removedCriteria.map((criterion, index) => (
                    <li
                      key={`${criterion}-${index}`}
                      className={`border-t ${ruleClass} pt-3 text-left ${bodyClass} ${smokeClass}`}
                    >
                      {criterion}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={`mt-3 ${bodyCopyClass}`}>
                  No criteria were removed from this post.
                </p>
              )}
            </div>

            <div className={`mt-8 ${metaRowClass}`}>
              <span>source=simulated</span>
              <span aria-hidden="true">·</span>
              <span>{asText(rewrite.job_post_id, jobPostId)}</span>
            </div>
            <DisclaimerNote
              disclaimer={rewrite.disclaimer}
              scope="Job post rewrite"
            />
          </div>
        )}
      </div>
    </BlockShell>
  )
}

export default function HRConsole({ baseUrl = '' }) {
  const [jobPostId, setJobPostId] = useState(DEFAULT_JOB_POST_ID)
  const [rewrite, setRewrite] = useState(EMPTY_RESULT)
  const [rewriteError, setRewriteError] = useState('')
  const [isRewriteLoading, setIsRewriteLoading] = useState(true)
  // `decision` is one made on this page; `priorDecision` is read back from
  // the backend and only annotates the buttons.
  const [decision, setDecision] = useState(EMPTY_RESULT)
  const [priorDecision, setPriorDecision] = useState(EMPTY_RESULT)
  const [decisionError, setDecisionError] = useState('')
  const [isDeciding, setIsDeciding] = useState(false)

  // Each panel keeps the in-flight request so a newer submit cancels the older
  // one. Without this, two quick submits can resolve out of order and the stale
  // response wins. React StrictMode remounts these effects in development, so
  // this is also what stops the mount fetch from being issued twice.
  const rewriteRequestRef = useRef(/** @type {AbortController | null} */ (null))

  useEffect(
    () => () => {
      rewriteRequestRef.current?.abort()
    },
    [],
  )

  useEffect(() => {
    void loadRewrite(DEFAULT_JOB_POST_ID)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount fetch only
  }, [])

  async function loadRewrite(nextJobPostId) {
    rewriteRequestRef.current?.abort()

    const controller = new AbortController()
    rewriteRequestRef.current = controller
    setIsRewriteLoading(true)
    setRewriteError('')
    setRewrite(EMPTY_RESULT)
    setDecision(EMPTY_RESULT)
    setPriorDecision(EMPTY_RESULT)
    setDecisionError('')

    try {
      const response = await rewriteEmployerFilter(nextJobPostId, {
        baseUrl,
        signal: controller.signal,
      })

      if (rewriteRequestRef.current === controller) {
        setRewrite(response)
        void loadDecision(asText(response?.job_post_id, nextJobPostId), controller)
      }
    } catch (requestError) {
      if (rewriteRequestRef.current === controller) {
        setRewriteError(readRewriteError(requestError))
      }
    } finally {
      if (rewriteRequestRef.current === controller) {
        setIsRewriteLoading(false)
      }
    }
  }

  // A decision may already exist, made here earlier or in the SAP Build Apps
  // approval screen, so it is read back with the post and shown beside the
  // buttons. No decision yet (404) or a failed read shows nothing extra.
  async function loadDecision(postId, controller) {
    try {
      const latest = await getEmployerDecision(postId, {
        baseUrl,
        signal: controller.signal,
      })

      if (
        rewriteRequestRef.current === controller &&
        typeof latest?.decision === 'string'
      ) {
        setPriorDecision(latest)
      }
    } catch {
      // Nothing recorded yet, or not readable: the sign-off buttons stay.
    }
  }

  function handleRewriteSubmit(event) {
    event.preventDefault()
    void loadRewrite(jobPostId)
  }

  async function handleDecide(postId, approved) {
    setIsDeciding(true)
    setDecisionError('')

    try {
      setDecision(await decideEmployerRewrite(postId, approved, { baseUrl }))
    } catch (requestError) {
      setDecisionError(
        formatErrorMessage(requestError, 'The decision could not be recorded. Try again.'),
      )
    } finally {
      setIsDeciding(false)
    }
  }

  return (
    <div>
      <p className={noteClass}>
        The job posts and hidden-talent counts here are sample data, labelled
        simulated.
      </p>

      <div>
        <RewriteBlock
          jobPostId={jobPostId}
          rewrite={rewrite}
          error={rewriteError}
          isLoading={isRewriteLoading}
          className="mt-12"
          onJobPostChange={(event) => setJobPostId(event.target.value)}
          onSubmit={handleRewriteSubmit}
          decision={decision}
          priorDecision={priorDecision}
          decisionError={decisionError}
          isDeciding={isDeciding}
          onDecide={handleDecide}
          onDecideAgain={() => {
            setPriorDecision(decision)
            setDecision(EMPTY_RESULT)
          }}
        />
      </div>
    </div>
  )
}
