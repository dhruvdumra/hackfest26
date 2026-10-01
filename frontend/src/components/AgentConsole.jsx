import { metaClass, smokeClass } from '../styles/classes.js'

/* The hero's right-hand column: a real session console.
 *
 * The page used to end its hero with a decorative dot-map illustration — a
 * jittered lattice of circles with four lumpy clusters. It read as a
 * hand-drawn sketch rather than as a schematic, and it spent the hero's most
 * valuable property on something the page cannot do. This is the replacement,
 * and it is a component rather than artwork because the run it reports is the
 * same `events` array the WorkerApp panel below already receives: the hero
 * shows the real run, and pressing Run pipeline ticks it.
 *
 * Two rules keep it inside the style system rather than beside it:
 *
 *   1. No Pulse Green. The reference confines that accent to "the single
 *      live-status dot in the badge", and the hero already carries that badge.
 *      A run's liveness is carried by Chalk against Graphite here.
 *   2. Nothing here is a card. No border box, no fill, no radius. The console
 *      is separated from the copy column by hairlines and air, because a
 *      bordered surface this close to the glossy pill would compete with it.
 */

/* The six pipeline agents in run order. The orchestrator is deliberately not a
 * rail item: it opens the session and is not one of the six, which is the count
 * the Pipeline Agent grid and the hero's own copy both state. `shortLabel` is
 * the rail's own vocabulary — 11px mono in a grid column does not have room for
 * "Inclusive matching", and the full names are one screen further down. */
const AGENT_RAIL = [
  'SKILLS DISCOVERY',
  'MARKET INTELLIGENCE',
  'LEARNING PATHWAY',
  'INCLUSIVE MATCHING',
  'EMPLOYER READINESS',
  'BIAS AUDIT',
]

const RAIL_SHORT_LABELS = {
  'SKILLS DISCOVERY': 'Skills',
  'MARKET INTELLIGENCE': 'Market',
  'LEARNING PATHWAY': 'Pathway',
  'INCLUSIVE MATCHING': 'Match',
  'EMPLOYER READINESS': 'Employer',
  'BIAS AUDIT': 'Audit',
}

// A run is one line per event, so an unbounded list would grow the hero without
// limit. Rows now wrap at a size a projector audience can read, so seven is what
// fits the column; the header count still reports the true total.
const VISIBLE_EVENTS = 7

/* A status the backend has not defined yet renders in the muted outline rather
 * than borrowing the run's Chalk cue — an unknown value is a backend change, and
 * it should not read as success. */
const STATUS_DETAILS = {
  running: 'bg-chalk',
  done: 'bg-chalk',
  // Waiting on a person: a hollow ring, the one row that asks for action.
  waiting_consent: 'border border-chalk bg-transparent',
  error: 'border border-graphite bg-transparent',
  invalid: 'border border-graphite bg-transparent',
}

const UNKNOWN_STATUS_DOT = 'border border-graphite bg-transparent'
const INLINE_DOT_CLASS = 'h-1.5 w-1.5 shrink-0 rounded-full'

const CONSOLE_CLASS = 'flex min-w-0 flex-col'
const HEADER_CLASS =
  'flex items-center justify-between gap-4 border-b border-graphite pb-3'
const HEADER_LABEL_CLASS = `${metaClass} ${smokeClass} uppercase`
const CHALK_META_CLASS = `${metaClass} text-chalk`

// Six columns at `lg`, three at `sm`, two below. Six labels in one row at 390px
// is ~46px each, and the mono voice turns to mush at that width.
const RAIL_CLASS = 'mt-6 grid grid-cols-2 gap-y-4 sm:grid-cols-3 lg:grid-cols-6'
const RAIL_ITEM_CLASS = 'flex min-w-0 flex-col gap-2'
const RAIL_TICK_CLASS = 'h-px w-full bg-graphite'
const RAIL_TICK_ACTIVE_CLASS = 'h-px w-full bg-chalk'
const RAIL_LABEL_CLASS = `truncate uppercase ${metaClass} ${smokeClass}`

// The log grows to its own content instead of claiming a fixed height. A
// `h-64` box with the rows bottom-aligned was technically stable, but at event 4
// it left ~200px of dead space between the rail and the first row, which read as
// a layout bug rather than as a terminal filling up. The log is already bounded
// by construction — VISIBLE_EVENTS caps it at ten rows, ~250px — so it needs no
// height of its own, and `overflow-y-auto` stays only as a guard for a
// pathologically narrow viewport where rows wrap.
const LOG_CLASS = 'mt-6 flex flex-col overflow-y-auto border-t border-graphite'
const LOG_LIST_CLASS = 'mt-3 flex flex-col gap-2.5'

const ROW_CLASS = 'flex items-baseline gap-3'
// Wraps instead of truncating: the numbers at the end of a message are the point.
const ROW_TIME_CLASS = `shrink-0 tabular-nums ${metaClass} ${smokeClass}`
const ROW_AGENT_CLASS = `shrink-0 uppercase ${metaClass} text-chalk`
const ROW_MESSAGE_CLASS = 'min-w-0 flex-1 text-sm leading-snug'
const ROW_ACTION_CLASS = `mr-2 font-medium uppercase ${metaClass} text-chalk`
const ROW_DOT_CLASS = `${INLINE_DOT_CLASS} self-center`

// Nothing has run yet: one muted sentence. No dashed placeholder, no fake rows
// — the same empty-state rule every other panel on the page follows.
const IDLE_CLASS = `mt-3 flex-1 ${metaClass} ${smokeClass}`

const LOG_LABEL = 'Agent event stream'

/**
 * @param {{
 *   events?: {
 *     id: string,
 *     agent: string,
 *     status: string,
 *     message: string,
 *     timestamp: string,
 *   }[],
 *   isStreaming?: boolean,
 *   className?: string,
 * }} props
 */
export default function AgentConsole({
  events = [],
  isStreaming = false,
  className = '',
}) {
  const visibleEvents = events.slice(-VISIBLE_EVENTS)
  const isIdle = events.length === 0 && !isStreaming
  const lastEvent = events.length === 0 ? null : events[events.length - 1]
  /* Completed agents, as a Set and restricted to the rail.
   *
   * A Set, not a count: the orchestrator emits both a `running` and a `done`
   * event for every stage, so counting events would report "8/6 agents done".
   *
   * Restricted to the six rail names, because the orchestrator also reports
   * `done` and is deliberately not a rail item — counting it made the footer
   * disagree with the rail above it, and a finished run read "7/6 agents done".
   * The footer and the rail now count the same set, so they cannot disagree. */
  const completedAgents = new Set(
    events
      .filter((event) => event.status === 'done' && AGENT_RAIL.includes(event.agent))
      .map((event) => event.agent),
  )

  return (
    <div className={`${CONSOLE_CLASS} ${className}`.trim()}>
      <div className={HEADER_CLASS}>
        <p className={HEADER_LABEL_CLASS}>{LOG_LABEL}</p>
        <p className={CHALK_META_CLASS}>
          {`${events.length} ${events.length === 1 ? 'event' : 'events'}`}
        </p>
      </div>

      {/* The rail and the log read the same array, so they cannot disagree: a
          tick fills when that agent has reported at all, which is derived state
          rather than a second source of truth. */}
      <ol className={RAIL_CLASS} aria-label="Pipeline agents reporting">
        {AGENT_RAIL.map((agent) => (
          <li key={agent} className={RAIL_ITEM_CLASS}>
            <span
              aria-hidden="true"
              className={
                completedAgents.has(agent) ? RAIL_TICK_ACTIVE_CLASS : RAIL_TICK_CLASS
              }
            />
            <span className={RAIL_LABEL_CLASS}>{RAIL_SHORT_LABELS[agent]}</span>
          </li>
        ))}
      </ol>

      <div className={LOG_CLASS}>
        {isIdle ? (
          <p className={IDLE_CLASS}>
            No session open. Press Run pipeline and the six agents report here.
          </p>
        ) : (
          <ol
            className={LOG_LIST_CLASS}
            aria-label={LOG_LABEL}
            aria-live="polite"
            aria-relevant="additions"
          >
            {visibleEvents.map((event) => (
              <li key={event.id} className={ROW_CLASS}>
                <span
                  aria-hidden="true"
                  className={`${ROW_DOT_CLASS} ${STATUS_DETAILS[event.status] ?? UNKNOWN_STATUS_DOT}`}
                />
                <span className={ROW_TIME_CLASS}>{event.timestamp}</span>
                <span className={ROW_AGENT_CLASS}>{event.agent}</span>
                <span
                  className={`${ROW_MESSAGE_CLASS} ${event.status === 'done' ? 'text-chalk' : 'text-smoke'}`}
                >
                  {event.status === 'waiting_consent' ? (
                    <span className={ROW_ACTION_CLASS}>Action needed</span>
                  ) : null}
                  {event.message}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* The footer reports the run's arithmetic instead of decorating it, so a
          reader can check the header's count against the rail. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-graphite pt-4">
        <span className={CHALK_META_CLASS}>
          {`${completedAgents.size}/6 agents done`}
        </span>
        <span className={metaClass + ' ' + smokeClass}>
          {isStreaming
            ? 'streaming'
            : isIdle
              ? 'idle'
              : `last · ${lastEvent?.agent ?? '—'}`}
        </span>
      </div>
    </div>
  )
}
