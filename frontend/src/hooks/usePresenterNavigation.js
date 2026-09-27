import { useCallback, useEffect, useRef, useState } from 'react'

// A section counts as the current step once its top edge has passed this share
// of the viewport. 35% keeps a step current while its heading is still on
// screen, rather than only once it has scrolled to the very top.
const ACTIVE_LINE_RATIO = 0.35

// A smooth scroll takes a few hundred milliseconds. While it runs, the scroll
// position still reports the step being left, so a second Next press would
// target the same section again. The requested step stands in for the real
// one until the scroll has had time to land.
const PENDING_SETTLE_MS = 900

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"]'

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function readActiveIndex(ids) {
  const line = window.innerHeight * ACTIVE_LINE_RATIO
  let active = -1

  ids.forEach((id, index) => {
    const element = document.getElementById(id)

    if (element !== null && element.getBoundingClientRect().top <= line) {
      active = index
    }
  })

  return active
}

function isEditableTarget(target) {
  return target instanceof Element && target.closest(EDITABLE_SELECTOR) !== null
}

/**
 * Track which demo step is on screen, and move between steps.
 *
 * Returns the current step (`-1` while the hero is still in view) and `goTo`,
 * which scrolls a step's section to the top. The left and right arrow keys
 * step backwards and forwards, except while focus is in a form field, where
 * the arrows belong to the field.
 *
 * @param {string[]} ids section ids, in step order
 */
export function usePresenterNavigation(ids) {
  const [activeIndex, setActiveIndex] = useState(-1)
  const pendingRef = useRef(/** @type {{ index: number, timer: number } | null} */ (null))
  const activeRef = useRef(activeIndex)

  useEffect(() => {
    activeRef.current = activeIndex
  }, [activeIndex])

  useEffect(() => {
    let frame = 0

    const update = () => {
      frame = 0
      setActiveIndex(readActiveIndex(ids))
    }
    const schedule = () => {
      if (frame === 0) {
        frame = window.requestAnimationFrame(update)
      }
    }

    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)

    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [ids])

  useEffect(
    () => () => {
      if (pendingRef.current !== null) {
        window.clearTimeout(pendingRef.current.timer)
      }
    },
    [],
  )

  const goTo = useCallback(
    (index) => {
      if (index < 0 || index >= ids.length) {
        return
      }

      const element = document.getElementById(ids[index])

      if (element === null) {
        return
      }

      if (pendingRef.current !== null) {
        window.clearTimeout(pendingRef.current.timer)
      }

      pendingRef.current = {
        index,
        timer: window.setTimeout(() => {
          pendingRef.current = null
        }, PENDING_SETTLE_MS),
      }
      element.scrollIntoView?.({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      })
      setActiveIndex(index)
    },
    [ids],
  )

  const step = useCallback(
    (offset) => {
      const current = pendingRef.current?.index ?? activeRef.current
      goTo(Math.min(ids.length - 1, Math.max(0, current + offset)))
    },
    [goTo, ids.length],
  )

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isEditableTarget(event.target)
      ) {
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        step(1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        step(-1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [step])

  return { activeIndex, goTo, next: () => step(1), previous: () => step(-1) }
}
