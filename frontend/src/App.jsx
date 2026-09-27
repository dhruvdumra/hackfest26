import { useCallback, useState } from 'react'
import AgentConsole from './components/AgentConsole.jsx'
import ConsentCard from './components/ConsentCard.jsx'
import GhostTwinPanel from './components/GhostTwinPanel.jsx'
import HiringDecision from './components/HiringDecision.jsx'
import Logo from './components/Logo.jsx'
import Manifesto from './components/Manifesto.jsx'
import MatchPanel from './components/MatchPanel.jsx'
import PipelineAgentGrid from './components/PipelineAgentGrid.jsx'
import PresenterBar from './components/PresenterBar.jsx'
import Reveal from './components/Reveal.jsx'
import SessionCard from './components/SessionCard.jsx'
import StatusBadge from './components/StatusBadge.jsx'
import Switch from './components/Switch.jsx'
import WorkSamplePanel from './components/WorkSamplePanel.jsx'
import { Button } from './components/Button.jsx'
import { useDemoMode } from './context/DemoModeContext.jsx'
import { DEMO_MOMENTS } from './data/demoMoments.js'
import { startSession } from './api.js'
import { useSessionStream } from './hooks/useSessionStream.js'
import { useAgentStream } from './hooks/useAgentStream.js'
import { usePresenterNavigation } from './hooks/usePresenterNavigation.js'
import {
  DisplacementRadarPanel,
  EmployerRewritePanel,
} from './pages/HRConsole.jsx'
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

const MOMENT_IDS = DEMO_MOMENTS.map((moment) => moment.id)
const TWO_KEY_STEP = MOMENT_IDS.indexOf('keys')
const EMPTY_SKILLS = []

// In-page anchors. The presenter bar carries the five demo steps, so the nav
// only needs the three places a judge asks to jump to: the start of the demo,
// the signature audit, and the explanation below the demo.
const NAV_LINKS = [
  { href: '#voice', label: 'Demo', isNew: false },
  { href: '#audit', label: 'Ghost Twins', isNew: true },
  { href: '#how-it-works', label: 'How it works', isNew: false },
]

/** The reference's nav: the wordmark carries the subtitle underneath. */
const WORDMARK_CLASS = `${headingXsClass} font-medium ${chalkClass}`
const WORDMARK_SUB_CLASS = `mt-1 block ${metaClass} ${smokeClass}`

// 24px gaps, the reference's stated nav-link interval. The wordmark, the
// divider and the links are one optical group, so the divider sits on the
// group rather than being spaced off it.
const NAV_LINK_CLASS =
  'font-aeonik text-sm font-normal uppercase leading-none text-smoke transition-colors hover:text-chalk'
const NAV_RULE_CLASS = 'text-iron'

/* The nav collapses to a single row on mobile: the links, the wordmark
 * subtitle, the divider and the switch's state word hide below `md`, and the
 * switch label below `sm`, so the header never wraps into a multi-row bar that
 * covers the hero on a phone. */
const NAV_GROUP_CLASS = 'flex min-w-0 items-center gap-3 sm:gap-4 md:gap-6'
const NAV_LINK_LIST_CLASS = 'hidden items-center gap-6 md:flex'
const NAV_ACTIONS_CLASS = 'flex shrink-0 items-center gap-3 sm:gap-4 md:gap-6'
const NAV_DIVIDER_CLASS = `hidden ${NAV_RULE_CLASS} md:inline`
const WORDMARK_WRAP_CLASS = 'flex min-w-0 flex-col'

// The 24px icon-avatar that sits inside the glossy pill: dark fill, light
// glyph, circular.
const LOGOMARK_CLASS =
  'grid h-6 w-6 shrink-0 place-items-center rounded-full bg-obsidian text-[0.625rem] font-medium leading-none text-chalk'

/* ── Hero rhythm ──────────────────────────────────────────────────────────
 * Three values, tightening as the eye moves down the block: the headline and
 * its sub-headline are one thought, the badge stands off as page metadata, and
 * the buttons follow the badge closely. */
const HERO_CLASS = 'pt-8 lg:pt-14'
const HERO_SUBHEAD_GAP_CLASS = 'mt-6'
const HERO_BADGE_GAP_CLASS = 'mt-10'
const HERO_ACTIONS_GAP_CLASS = 'mt-5'

/* Two columns: the argument on the left, the run itself on the right. The
 * console column is capped at 26rem so each row keeps a full agent name and
 * most of its message, and the headline keeps the width it needs to stay on
 * two lines at 63px. Below `lg` the console sits under the copy. */
const HERO_GRID_CLASS =
  'grid items-start gap-16 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-20'

function Logomark() {
  return (
    <span aria-hidden="true" className={LOGOMARK_CLASS}>
      <Logo size={14} />
    </span>
  )
}

function NavLinks() {
  return (
    <nav aria-label="Sections" className={NAV_LINK_LIST_CLASS}>
      {NAV_LINKS.map((link) => (
        <a key={link.href} href={link.href} className={NAV_LINK_CLASS}>
          {link.label}
          {link.isNew ? (
            <sup className="ml-1 font-input text-[0.625rem] tracking-normal text-compass-gold">
              new
            </sup>
          ) : null}
        </a>
      ))}
    </nav>
  )
}

/**
 * A full-content-width 1px Graphite rule plus air. Sections are separated by
 * the line, never by a change of background. `scroll-mt-28` clears the sticky
 * header when the presenter jumps to a step.
 *
 * @param {{
 *   children?: import('react').ReactNode,
 *   className?: string,
 *   id?: string,
 *   step?: string,
 *   eyebrow?: string,
 *   title?: string,
 *   description?: string,
 * }} props
 */
function Section({
  children,
  className = '',
  id,
  step,
  eyebrow,
  title,
  description,
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-heading` : undefined}
      className={`mt-28 scroll-mt-28 border-t pt-16 ${ruleClass} ${className}`.trim()}
    >
      {eyebrow === undefined && title === undefined ? null : (
        <header className="mb-16">
          {eyebrow === undefined ? null : (
            <p className={`${metaClass} ${smokeClass} uppercase`}>
              {/* A demo step's number takes the deck's amber route colour, so
                  the five stops read as one line down the page. */}
              {step === undefined ? null : (
                <span className="text-route">{`Step ${step} · `}</span>
              )}
              {eyebrow}
            </p>
          )}
          {title === undefined ? null : (
            <h2
              id={id ? `${id}-heading` : undefined}
              className={`mt-3 font-aeonik text-heading font-normal leading-heading ${chalkClass}`}
            >
              {title}
            </h2>
          )}
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
  const [session, setSession] = useState(/** @type {any} */ (null))
  const [sessionRefresh, setSessionRefresh] = useState(0)
  const [startError, setStartError] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [runSignal, setRunSignal] = useState(0)
  // Each press of Run pipeline is a new replay of the recorded run. Zero means
  // nobody has pressed it yet, so demo mode shows an idle console instead of a
  // run that started on page load.
  const [demoRun, setDemoRun] = useState(0)
  const presenter = usePresenterNavigation(MOMENT_IDS)

  const fallback = useAgentStream({
    enabled: demoRun > 0,
    sessionId: `demo-run-${demoRun}`,
  })
  const stream = useSessionStream({
    sessionId,
    enabled: Boolean(sessionId) && !demoMode,
    baseUrl: backendBaseUrl,
  })

  const usingLiveTransport = !demoMode && Boolean(sessionId)
  const events = usingLiveTransport ? stream.events : fallback.events
  const skills = session?.passport?.skills ?? EMPTY_SKILLS

  const handleSessionStart = useCallback(
    async (payload) => {
      setIsStarting(true)
      setStartError('')
      setDemoRun((current) => current + 1)
      try {
        const started = await startSession(payload, { baseUrl: backendBaseUrl })
        setSessionId(started.session_id)
      } catch (requestError) {
        setStartError(
          requestError instanceof Error ? requestError.message : 'Could not start the session.',
        )
      } finally {
        setIsStarting(false)
      }
    },
    [backendBaseUrl],
  )

  const isStreaming = isStarting || (usingLiveTransport && stream.status === 'connecting')
  const isBusy = isStreaming || (isStarting && !sessionId)

  // Both glossy pills are the same primary action, so both raise the same
  // signal; the intake form is the only thing that knows the transcript.
  const requestRun = useCallback(() => {
    setRunSignal((current) => current + 1)
  }, [])

  const refreshSession = useCallback(() => {
    setSessionRefresh((current) => current + 1)
  }, [])

  const { goTo } = presenter
  const startWalkthrough = useCallback(() => goTo(0), [goTo])
  const showTwoKeyStep = useCallback(() => goTo(TWO_KEY_STEP), [goTo])

  /** @type {Record<string, import('react').ReactNode>} */
  const momentContent = {
    voice: (
      <>
        <WorkerApp
          baseUrl={backendBaseUrl}
          sessionId={sessionId}
          onSessionStart={handleSessionStart}
          events={events}
          isStreaming={isStreaming}
          runSignal={runSignal}
          onSessionChange={setSession}
          refreshSignal={sessionRefresh}
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
      </>
    ),
    proof: (
      <WorkSamplePanel
        baseUrl={backendBaseUrl}
        sessionId={sessionId}
        skills={skills}
        onScored={refreshSession}
      />
    ),
    route: (
      <div className="space-y-24">
        <DisplacementRadarPanel baseUrl={backendBaseUrl} />
        <RouteMap baseUrl={backendBaseUrl} />
        <MatchPanel
          baseUrl={backendBaseUrl}
          sessionId={sessionId}
          passportId={session?.passport?.passport_id ?? null}
        />
      </div>
    ),
    audit: <GhostTwinPanel baseUrl={backendBaseUrl} />,
    keys: (
      <div className="space-y-24">
        <ConsentCard
          baseUrl={backendBaseUrl}
          sessionId={sessionId}
          session={session}
          events={events}
          onDecided={refreshSession}
        />
        <EmployerRewritePanel
          baseUrl={backendBaseUrl}
          renderDecision={(rewrite) =>
            // A post the filter hid nobody from has nothing to sign off.
            typeof rewrite.hidden_talent_count === 'number' && rewrite.hidden_talent_count > 0 ? (
              <HiringDecision
                baseUrl={backendBaseUrl}
                jobPostId={String(rewrite.job_post_id)}
                hiddenTalentCount={rewrite.hidden_talent_count}
              />
            ) : null
          }
        />
      </div>
    ),
  }

  return (
    // The bottom padding keeps the footer clear of the fixed presenter bar.
    <div className="min-h-dvh bg-obsidian pb-16 font-aeonik text-chalk">
      {/* The nav floats over the canvas on an opaque scrim — translucent let
          the hero headline show through as it scrolled under — and carries a
          single hairline, the only border on the header. */}
      <header className="sticky top-0 z-50">
        <div className="bg-obsidian">
          <div
            className={`${pageColumnClass} flex items-center justify-between gap-4 py-4 md:py-5`}
          >
            <div className={NAV_GROUP_CLASS}>
              <div className={WORDMARK_WRAP_CLASS}>
                <span className={WORDMARK_CLASS}>ReRoute</span>
                <span className={`${WORDMARK_SUB_CLASS} hidden md:block`}>
                  Career orchestration
                </span>
              </div>
              <span aria-hidden="true" className={NAV_DIVIDER_CLASS}>
                |
              </span>
              <NavLinks />
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
        {/* Hero, left-aligned. Display steps 32 → 44 → 63px on the same
            leading and tracking; 32px is the base so the first line holds as
            one unit on a 390px phone. The headline is the deck's own tagline,
            so the demo opens on the line the pitch closed on. */}
        <div className={`${pageColumnClass} ${HERO_CLASS}`}>
          {/* The headline spans the full column, above the two-column row.
              "When AI moves the job," is ~760px at 63px, wider than the copy
              column beside the console, and squeezed into it the tagline broke
              into three ragged lines. */}
          <Reveal>
            <h1
              id="demo-title"
              className={`${typeDisplayClass} ${chalkClass} text-[2rem] sm:text-heading-lg lg:text-display`}
            >
              When AI moves the job,
              <span className={`block italic ${smokeClass}`}>we move the path.</span>
            </h1>
          </Reveal>

          <div className={`${HERO_GRID_CLASS} ${HERO_SUBHEAD_GAP_CLASS}`}>
            <div className="min-w-0">
              <Reveal delay={70}>
                <p className={`${subheadingClass} ${readingClass} ${smokeClass}`}>
                  An agentic career orchestrator for the people AI leaves
                  behind. Six agents prove the skills, plan a paid route and
                  audit every ranking for bias — and a human holds the key at
                  every high-stakes step.
                </p>
              </Reveal>

              <Reveal delay={140} className={HERO_BADGE_GAP_CLASS}>
                {/* A judge reads this badge, so it names the data source in
                    their words rather than a build slice: demo mode replays a
                    recorded agent run, and turning it off streams from the
                    backend. */}
                <StatusBadge
                  live={!demoMode}
                  label={demoMode ? 'Demo mode · recorded agent run' : 'Live backend · streaming'}
                />
              </Reveal>

              <Reveal delay={210} className={HERO_ACTIONS_GAP_CLASS}>
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
                  <Button variant="ghost" arrow="↓" onClick={startWalkthrough}>
                    Walk through the demo
                  </Button>
                </div>
              </Reveal>
            </div>

            {/* The live run, not a picture of one: it reads the same `events`
                the intake panel does, so the two cannot drift apart. */}
            <Reveal delay={280} className="min-w-0">
              <AgentConsole events={events} isStreaming={isStreaming} />
            </Reveal>
          </div>
        </div>

        <div className={pageColumnClass}>
          {DEMO_MOMENTS.map((moment) => (
            <Section
              key={moment.id}
              id={moment.id}
              step={moment.number}
              eyebrow={moment.eyebrow}
              title={moment.title}
              description={moment.description}
            >
              {momentContent[moment.id]}
            </Section>
          ))}

          {/* Below the demo: what each agent is, a finished run, and the rule
              the whole product answers to. A judge who wants the model reads
              on; the presenter never has to scroll past it to reach a step. */}
          <Section
            id="how-it-works"
            eyebrow="How it works"
            title="Six agents, one ordered run."
            description="Each agent takes the previous one's output and narrows the decision. The seventh node in the graph is the human gate, not an agent — which is why the count here is six."
          >
            <Reveal>
              <PipelineAgentGrid />
            </Reveal>
          </Section>

          <Section
            eyebrow="A recorded run"
            title="What a finished run looks like."
            description="One session end to end, with the persona, the pivot and the date it happened. Nothing here claims an outcome the backend cannot evidence."
          >
            <Reveal>
              <SessionCard />
            </Reveal>
          </Section>

          <Reveal>
            <Manifesto
              ctaLabel="See both keys in the demo"
              ctaArrow="↑"
              onCtaClick={showTwoKeyStep}
            />
          </Reveal>
        </div>
      </main>

      <footer className={`mt-28 border-t py-8 ${ruleClass}`}>
        <div className={pageColumnClass}>
          <p className={`font-aeonik text-sm font-normal ${chalkClass}`}>
            Team ReRoute · SRM University AP
          </p>
          <p className={`mt-2 ${metaClass} ${smokeClass}`}>
            github.com/mevarx/hackfest26 · SAP Hackfest 2026
          </p>
        </div>
      </footer>

      <PresenterBar
        moments={DEMO_MOMENTS}
        activeIndex={presenter.activeIndex}
        onSelect={presenter.goTo}
        onNext={presenter.next}
        onPrevious={presenter.previous}
      />
    </div>
  )
}
