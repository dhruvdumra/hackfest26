import { chalkClass, metaClass, pageColumnClass, smokeClass } from '../styles/classes.js'
import { Button } from './Button.jsx'

/* The presenter's control strip.
 *
 * The demo is a seven-minute walk through five moments, and the presenter has
 * to land each one on cue rather than scroll-hunt for it with a room watching.
 * This bar pins the five stops to the bottom of the viewport: it names the
 * step on screen, jumps to any stop, and pairs with the arrow keys that
 * `usePresenterNavigation` binds. It sits at the bottom so the sticky header
 * keeps the top for Run pipeline and the demo-mode switch.
 *
 * The stops read as one route line — the deck's metro motif — with the line
 * behind the presenter filled and the line ahead left as structure. */

const BAR_CLASS = 'fixed inset-x-0 bottom-0 z-40 border-t border-graphite bg-obsidian'
const STOP_DOT_CLASS = 'h-2.5 w-2.5 shrink-0 rounded-full'

/** @type {Record<'done' | 'current' | 'ahead', { dot: string, label: string }>} */
const STOP_STATE = {
  done: { dot: 'bg-route', label: smokeClass },
  current: { dot: 'bg-route ring-4 ring-route/25', label: chalkClass },
  ahead: { dot: 'border border-iron bg-transparent', label: smokeClass },
}

function stopState(index, activeIndex) {
  if (index === activeIndex) {
    return 'current'
  }

  return index < activeIndex ? 'done' : 'ahead'
}

/**
 * @param {{
 *   moments: { id: string, label: string }[],
 *   activeIndex: number,
 *   onSelect: (index: number) => void,
 *   onNext: () => void,
 *   onPrevious: () => void,
 * }} props
 */
export default function PresenterBar({
  moments,
  activeIndex,
  onSelect,
  onNext,
  onPrevious,
}) {
  const current = activeIndex >= 0 ? moments[activeIndex] : null
  const isFirst = activeIndex <= 0
  const isLast = activeIndex >= moments.length - 1

  return (
    <nav aria-label="Demo steps" className={BAR_CLASS}>
      <div className={`${pageColumnClass} flex h-16 items-center gap-6`}>
        <p className={`shrink-0 ${metaClass} ${smokeClass}`} aria-live="polite">
          {current === null ? (
            'Demo · 5 steps'
          ) : (
            <>
              {`Step ${activeIndex + 1} of ${moments.length} · `}
              <span className={chalkClass}>{current.label}</span>
            </>
          )}
        </p>

        <ol className="hidden min-w-0 flex-1 items-center md:flex">
          {moments.map((moment, index) => {
            const state = STOP_STATE[stopState(index, activeIndex)]
            const isLastStop = index === moments.length - 1

            return (
              <li
                key={moment.id}
                className={`flex min-w-0 items-center ${isLastStop ? '' : 'flex-1'}`}
              >
                {/* The label is written on screen only from `lg`; between
                    `md` and `lg` a stop is its dot alone, so the name comes
                    from `aria-label` at every width. */}
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  aria-current={index === activeIndex ? 'step' : undefined}
                  aria-label={moment.label}
                  className="flex shrink-0 items-center gap-2 rounded-[6px] px-1.5 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ash"
                >
                  <span aria-hidden="true" className={`${STOP_DOT_CLASS} ${state.dot}`} />
                  <span
                    aria-hidden="true"
                    className={`hidden whitespace-nowrap lg:inline ${metaClass} ${state.label}`}
                  >
                    {moment.label}
                  </span>
                </button>
                {isLastStop ? null : (
                  <span
                    aria-hidden="true"
                    className={`mx-2 h-px min-w-4 flex-1 ${
                      index < activeIndex ? 'bg-route' : 'bg-graphite'
                    }`}
                  />
                )}
              </li>
            )
          })}
        </ol>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <span className={`hidden xl:inline ${metaClass} ${smokeClass}`}>
            ← → keys
          </span>
          <Button
            variant="ghost"
            onClick={onPrevious}
            disabled={isFirst}
            aria-label="Previous step"
          >
            ←
          </Button>
          <Button
            variant="ghost"
            onClick={onNext}
            disabled={isLast}
            aria-label={current === null ? 'Start the walkthrough' : 'Next step'}
          >
            {current === null ? 'Start' : '→'}
          </Button>
        </div>
      </div>
    </nav>
  )
}
