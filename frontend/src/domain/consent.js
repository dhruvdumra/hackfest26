const ANSWERS = new Set(['accepted', 'declined', 'timed_out'])

/**
 * Where the Two-Key step stands, read from the event stream alone: the
 * orchestrator asks with `waiting_consent` and closes with a `done` event that
 * carries the answer in `data.consent`.
 *
 * @returns {'idle' | 'waiting' | 'accepted' | 'declined' | 'timed_out'}
 */
export function readConsent(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]

    if (event?.agent !== 'ORCHESTRATOR') {
      continue
    }

    const answer = event.data?.consent

    if (event.status === 'done' && ANSWERS.has(answer)) {
      return answer
    }

    if (event.status === 'waiting_consent') {
      return 'waiting'
    }
  }

  return 'idle'
}
