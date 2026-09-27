import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEMO_MOMENTS } from '../data/demoMoments.js'
import { usePresenterNavigation } from '../hooks/usePresenterNavigation.js'
import PresenterBar from './PresenterBar.jsx'

const IDS = DEMO_MOMENTS.map((moment) => moment.id)

// jsdom lays nothing out, so every section reports a top of 0. Each test
// places the sections by stubbing their rects: `tops[i]` is the distance from
// the viewport top to section i.
function placeSections(tops) {
  IDS.forEach((id, index) => {
    const element = /** @type {HTMLElement} */ (document.getElementById(id))
    element.getBoundingClientRect = () => /** @type {DOMRect} */ ({ top: tops[index] })
  })
  act(() => {
    window.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(20)
  })
}

// The stops are hidden below `md`, where the bar keeps only Back and Next, and
// jsdom evaluates no media query, so a stop is queried as a hidden button.
function getStop(name) {
  return screen.getByRole('button', { name, hidden: true })
}

function Harness() {
  const presenter = usePresenterNavigation(IDS)

  return (
    <>
      {IDS.map((id) => (
        <section key={id} id={id} />
      ))}
      <input aria-label="Transcript" />
      <PresenterBar
        moments={DEMO_MOMENTS}
        activeIndex={presenter.activeIndex}
        onSelect={presenter.goTo}
        onNext={presenter.next}
        onPrevious={presenter.previous}
      />
    </>
  )
}

const originalScrollIntoView = Element.prototype.scrollIntoView

describe('PresenterBar', () => {
  /** @type {string[]} */
  let scrolledTo

  beforeEach(() => {
    vi.useFakeTimers()
    scrolledTo = []
    window.innerHeight = 1000
    Element.prototype.scrollIntoView = function scrollIntoView() {
      scrolledTo.push(this.id)
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    Element.prototype.scrollIntoView = originalScrollIntoView
  })

  it('reads as ready to start while the hero is on screen', () => {
    render(<Harness />)
    placeSections([1200, 2400, 3600, 4800, 6000])

    expect(screen.getByText('Demo · 5 steps')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous step' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start the walkthrough' })).toBeEnabled()
    // The arrow keys are announced, not only shown at xl as "← → keys".
    expect(screen.getByRole('button', { name: 'Start the walkthrough' })).toHaveAttribute(
      'aria-keyshortcuts',
      'ArrowRight',
    )
  })

  it('names the step whose section has scrolled past the active line', () => {
    render(<Harness />)
    placeSections([-2000, -800, 200, 1400, 2600])

    expect(screen.getByText(/Step 3 of 5/)).toHaveTextContent('Route & match')
    expect(getStop('Route & match')).toHaveAttribute(
      'aria-current',
      'step',
    )
  })

  it('jumps to a stop, and steps with the buttons and the arrow keys', () => {
    render(<Harness />)
    placeSections([1200, 2400, 3600, 4800, 6000])

    fireEvent.click(getStop('Ghost Twins'))
    expect(scrolledTo).toEqual(['audit'])

    // The smooth scroll has not landed yet, so Next builds on the requested
    // step rather than on the stale scroll position.
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    expect(scrolledTo).toEqual(['audit', 'keys'])

    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(scrolledTo).toEqual(['audit', 'keys', 'audit'])
  })

  it('leaves the arrow keys to a form field that has focus', () => {
    render(<Harness />)
    placeSections([1200, 2400, 3600, 4800, 6000])

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Transcript' }), {
      key: 'ArrowRight',
    })
    expect(scrolledTo).toEqual([])

    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(scrolledTo).toEqual(['voice'])
  })
})
