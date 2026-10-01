import { useCallback, useEffect, useMemo, useState } from 'react'
import AgentConsole from './components/AgentConsole.jsx'
import GhostTwinPanel from './components/GhostTwinPanel.jsx'
import Logo from './components/Logo.jsx'
import Manifesto from './components/Manifesto.jsx'
import PipelineAgentGrid from './components/PipelineAgentGrid.jsx'
import Reveal from './components/Reveal.jsx'
import SessionCard from './components/SessionCard.jsx'
import StatusBadge from './components/StatusBadge.jsx'
import Switch from './components/Switch.jsx'
import { Button } from './components/Button.jsx'
import { useDemoMode } from './context/DemoModeContext.jsx'
import { getHealth, startSession } from './api.js'
import { useSessionStream } from './hooks/useSessionStream.js'
import { useAgentStream } from './hooks/useAgentStream.js'
import { normalizeAgentEvent } from './domain/agentEvents.js'
import { describeBackendSource } from './domain/backendSource.js'
import { readConsent } from './domain/consent.js'
import HRConsole from './pages/HRConsole.jsx'
import MarketRadar from './pages/MarketRadar.jsx'
import RouteMap from './pages/RouteMap.jsx'
import WorkerApp from './pages/WorkerApp.jsx'
import {
  bodyClass,
  chalkClass,
  headingXsClass,
  metaClass,
  pageColumnClass,
  readingClass,
  ruleClass,
  smokeClass,
  subheadingClass,
  typeDisplayClass,
} from './styles/classes.js'

// The orchestrator's own closing lines, so a demo-mode answer reads the same.
const LOCAL_CONSENT_MESSAGES = {
  accepted: 'Kavya said yes · her Skill Passport is shared with employers',
  declined: 'Kavya said no · her Skill Passport stays private',
}

/* The five moments of the live demo, in the order the page now runs them.
 * The numbers are the one sequence on the page that carries information: the
 * presenter reads them to know where the next click is. */
const DEMO_STEPS = [
  { href: '#run', label: 'Run' },
  { href: '#pipeline', label: 'Consent' },
  { href: '#route', label: 'Route' },
  { href: '#audit', label: 'Ghost Twin' },
  { href: '#employer', label: 'Sign-off' },
]

const WORDMARK_CLASS = `${headingXsClass} font-medium ${chalkClass}`
const WORDMARK_SUB_CLASS = `mt-1 block ${metaClass} ${smokeClass}`
const NAV_ACTIONS_CLASS = 'flex shrink-0 items-center gap-3 sm:gap-4 md:gap-6'
const STEP_LIST_CLASS = 'hidden items-center gap-1 lg:flex'
const STEP_LINK_CLASS =
  'group flex items-center gap-2 rounded-full px-3 py-2 font-aeonik text-sm uppercase leading-none tracking-button text-smoke transition-colors hover:text-chalk focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-smoke'
const STEP_NUMBER_CLASS =
  'grid h-6 w-6 place-items-center rounded-full border border-iron font-input text-xs text-chalk'
// A waiting consent is the one step that needs the presenter now. It takes the
// Chalk ring and word, never amber: amber on this page only ever means FLAGGED.
const STEP_WAITING_CLASS = 'border-chalk bg-chalk text-obsidian'

const LOGOMARK_CLASS =
  'grid h-6 w-6 shrink-0 place-items-center rounded-full bg-obsidian text-xs font-medium leading-none text-chalk'

const HERO_CLASS = 'pt-8 lg:pt-14'
const HERO_GRID_CLASS =
  'grid items-start gap-16 lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-20'

function Logomark() {
  return (
    <span aria-hidden="true" className={LOGOMARK_CLASS}>
      <Logo size={14} />
    </span>
  )
}

function DemoSteps({ consentWaiting }) {
  return (
    <nav aria-label="Demo steps">
      <ol className={STEP_LIST_CLASS}>
        {DEMO_STEPS.map((step, index) => {
          const waiting = consentWaiting && step.href === '#pipeline'

          return (
            <li key={step.href}>
              <a
                href={step.href}
                className={`${STEP_LINK_CLASS} ${waiting ? 'text-chalk' : ''}`}
                aria-current={waiting ? 'step' : undefined}
              >
                <span
                  aria-hidden="true"
                  className={`${STEP_NUMBER_CLASS} ${waiting ? STEP_WAITING_CLASS : ''}`}
                >
                  {index + 1}
                </span>
                {waiting ? `${step.label} waiting` : step.label}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/**
 * A section of the page: a hairline, a heading that says what happens here,
 * and one sentence of why. No eyebrow above the heading; the demo steps in the
 * nav carry the sequence.
 *
 * @param {{
 *   children?: import('react').ReactNode,
 *   className?: string,
 *   id?: string,
 *   title?: string,
 *   description?: string,
 * }} props
 */
function Section({ children, className = '', id, title, description }) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-heading` : undefined}
      className={`mt-28 scroll-mt-24 border-t pt-16 ${ruleClass} ${className}`.trim()}
    >
      {title === undefined ? null : (
        <header className="mb-12">
          <h2
            id={id ? `${id}-heading` : undefined}
            className={`font-aeonik text-heading font-normal leading-heading ${chalkClass}`}
          >
            {title}
          </h2>
          {description === undefined ? null : (
            <p className={`mt-4 ${readingClass} ${bodyClass} ${smokeClass}`}>
              {description}
            </p>
          )}
        </header>
      )}
      {children}
    </section>
  )
}

export default function App() {
  const { demoMode, toggleDemoMode, backendBaseUrl } = useDemoMode()
  const [sessionId, setSessionId] = useState(null)
  const [startError, setStartError] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [runSignal, setRunSignal] = useState(0)
  const [demoRun, setDemoRun] = useState(0)
  // Keyed by backend URL, so a change of backend reads as "checking" again
  // without resetting state inside the effect.
  const [healthReport, setHealthReport] = useState(
    /** @type {{ url: string | null, value: object | 'down' | null }} */ ({ url: null, value: null }),
  )

  // The recorded run plays only in demo mode, and only once Run is pressed;
  // each press replays it from the first event.
  const recording = useAgentStream({
    enabled: demoMode && demoRun > 0,
    sessionId: `demo-run-${demoRun}`,
  })
  const stream = useSessionStream({
    sessionId,
    enabled: Boolean(sessionId) && !demoMode,
    baseUrl: backendBaseUrl,
  })

  useEffect(() => {
    if (demoMode) {
      return undefined
    }

    const controller = new AbortController()
    getHealth({ baseUrl: backendBaseUrl, signal: controller.signal })
      .then((next) => setHealthReport({ url: backendBaseUrl, value: next }))
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setHealthReport({ url: backendBaseUrl, value: 'down' })
        }
      })

    return () => controller.abort()
  }, [backendBaseUrl, demoMode])

  const health = healthReport.url === backendBaseUrl ? healthReport.value : null

  const usingLiveTransport = !demoMode && Boolean(sessionId)
  // In demo mode there is no session to answer the Two-Key question, so the
  // answer is closed out here, on screen only, the way the orchestrator would.
  const [localConsentEvent, setLocalConsentEvent] = useState(null)
  const events = useMemo(() => {
    if (usingLiveTransport) {
      return stream.events
    }

    if (!demoMode) {
      return []
    }

    return localConsentEvent === null
      ? recording.events
      : [...recording.events, localConsentEvent]
  }, [usingLiveTransport, demoMode, stream.events, recording.events, localConsentEvent])

  const handleLocalConsent = useCallback((decision) => {
    setLocalConsentEvent(
      normalizeAgentEvent(
        {
          agent: 'ORCHESTRATOR',
          status: 'done',
          message: LOCAL_CONSENT_MESSAGES[decision],
          data: { consent: decision, terminal: true },
        },
        { streamId: 'demo-consent' },
      ),
    )
  }, [])

  const handleSessionStart = useCallback(
    async (payload) => {
      setIsStarting(true)
      setStartError('')
      setLocalConsentEvent(null)

      if (demoMode) {
        setDemoRun((current) => current + 1)
      }

      try {
        const started = await startSession(payload, { baseUrl: backendBaseUrl })
        setSessionId(started.session_id)
      } catch (requestError) {
        // Demo mode exists for when no backend answers; the recording is the run.
        if (!demoMode) {
          setStartError(
            requestError instanceof Error ? requestError.message : 'Could not start the session.',
          )
        }
      } finally {
        setIsStarting(false)
      }
    },
    [backendBaseUrl, demoMode],
  )

  const isStreaming = isStarting || (usingLiveTransport && stream.status === 'connecting')
  const consentWaiting = readConsent(events) === 'waiting'
  const source = describeBackendSource({ demoMode, health, backendBaseUrl })

  // Both glossy pills are the same primary action; the form holds the
  // transcript, so they raise a signal rather than duplicate the request.
  const requestRun = useCallback(() => {
    setRunSignal((current) => current + 1)
  }, [])

  const isBusy = isStreaming || (isStarting && !sessionId)

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const scrollToAudit = useCallback(() => {
    document.getElementById('audit')?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  return (
    <div className="min-h-dvh bg-obsidian font-aeonik text-chalk">
      <header className="sticky top-0 z-50">
        <div className="bg-obsidian">
          <div
            className={`${pageColumnClass} flex items-center justify-between gap-4 py-4 md:py-5`}
          >
            <div className="flex min-w-0 items-center gap-6">
              <div className="flex min-w-0 flex-col">
                <span className={WORDMARK_CLASS}>ReRoute</span>
                <span className={`${WORDMARK_SUB_CLASS} hidden md:block`}>
                  Career orchestration
                </span>
              </div>
              <DemoSteps consentWaiting={consentWaiting} />
            </div>

            <div className={NAV_ACTIONS_CLASS}>
              <Switch
                id="demo-mode"
                checked={demoMode}
                onChange={toggleDemoMode}
                label="Demo mode"
                stateClassName="hidden md:inline"
                labelClassName="hidden sm:inline"
              />
              <Button
                variant="glossy"
                onClick={requestRun}
                disabled={isBusy}
                aria-busy={isBusy}
              >
                <Logomark />
                Run pipeline
              </Button>
            </div>
          </div>
          <div aria-hidden="true" className="h-px bg-graphite" />
        </div>
      </header>

      <main>
        <div id="run" className={`${pageColumnClass} ${HERO_CLASS} scroll-mt-24`}>
          <div className={HERO_GRID_CLASS}>
            <div className="min-w-0">
              <Reveal>
                <h1
                  id="demo-title"
                  className={`${typeDisplayClass} ${chalkClass} text-[2rem] sm:text-heading-lg lg:text-display`}
                >
                  AI automated Kavya’s job.
                  <span className="block italic">Six agents find her way back.</span>
                </h1>
              </Reveal>

              <Reveal delay={70} className="mt-6">
                <p className={`${subheadingClass} ${readingClass} ${smokeClass}`}>
                  Four years testing payments, then an 18-month caregiving
                  break, and every hiring filter says no. ReRoute proves her
                  skills, plans a paid route that fits 10 hours a week, and
                  audits every score for bias.
                </p>
              </Reveal>

              <Reveal delay={140} className="mt-10">
                <StatusBadge live={source.live} label={source.label} />
              </Reveal>

              <Reveal delay={210} className="mt-5">
                <div className="flex flex-wrap items-center gap-4">
                  <Button
                    variant="glossy"
                    onClick={requestRun}
                    disabled={isBusy}
                    aria-busy={isBusy}
                    arrow="↗"
                  >
                    <Logomark />
                    Run pipeline
                  </Button>
                  <Button variant="ghost" arrow="↓" onClick={scrollToAudit}>
                    See the bias audit
                  </Button>
                </div>
              </Reveal>
            </div>

            {/* The run itself: the same events the worker panel reads. */}
            <Reveal delay={280} className="min-w-0">
              <AgentConsole events={events} isStreaming={isStreaming} />
            </Reveal>
          </div>
        </div>

        <div className={pageColumnClass}>
          <Section
            id="pipeline"
            title="Her story in, her skills out."
            description="Paste or speak what Kavya actually did. Skills Discovery turns it into a Skill Passport, and nothing leaves ReRoute until she says yes."
          >
            <WorkerApp
              baseUrl={backendBaseUrl}
              sessionId={sessionId}
              onSessionStart={handleSessionStart}
              events={events}
              isStreaming={isStreaming}
              runSignal={runSignal}
              liveSession={usingLiveTransport}
              onLocalConsent={handleLocalConsent}
            />
            {startError === '' ? null : (
              <div role="alert" className="mt-12 space-y-3">
                <p className={`${metaClass} ${smokeClass} uppercase`}>
                  Session could not start
                </p>
                <p className={`${readingClass} ${bodyClass} ${chalkClass}`}>
                  {startError}
                </p>
              </div>
            )}
          </Section>

          <Section
            id="route"
            title="A paid route she can walk at 10 hours a week."
            description="Market Intelligence checks which roles are growing in her city. The Career GPS then finds the shortest bridge from the skills she has proven, on the SAP HANA Cloud skills graph."
          >
            <Reveal>
              <MarketRadar baseUrl={backendBaseUrl} />
            </Reveal>
            <Reveal className="mt-24">
              <RouteMap baseUrl={backendBaseUrl} />
            </Reveal>
          </Section>

          <Section
            id="audit"
            title="Change who she is. The score must not move."
            description="Ghost Twins re-score Kavya with one thing changed at a time: her career gap, gender, age, college or city. A fair screen stays flat. A legacy screen moves, and the audit freezes the decision."
          >
            <Reveal>
              <GhostTwinPanel baseUrl={backendBaseUrl} />
            </Reveal>
          </Section>

          <Section
            id="employer"
            title="Fix the employer’s filter, not the shortlist."
            description="The job post that hid her, rewritten from the audit, and signed off by a hiring manager before anything is published."
          >
            <Reveal>
              <HRConsole baseUrl={backendBaseUrl} />
            </Reveal>
          </Section>

          <Section
            title="Six agents, one ordered run."
            description="Each agent takes the previous one's output and narrows the decision. The seventh node in the graph is the human gate."
          >
            <Reveal>
              <PipelineAgentGrid />
            </Reveal>
          </Section>

          <Section
            title="What a finished run looks like."
            description="One session end to end, with the persona, the pivot and the date it happened."
          >
            <Reveal>
              <SessionCard />
            </Reveal>
          </Section>

          <Reveal>
            <Manifesto onCtaClick={scrollToTop} />
          </Reveal>
        </div>
      </main>

      <footer className={`mt-28 border-t py-8 ${ruleClass}`}>
        <div className={pageColumnClass}>
          <p className={`font-aeonik text-sm font-normal ${chalkClass}`}>
            Team ReRoute · SRM University-AP
          </p>
          <p className={`mt-2 ${metaClass} ${smokeClass}`}>
            github.com/mevarx/hackfest26 · SAP Hackfest 2026
          </p>
        </div>
      </footer>
    </div>
  )
}
