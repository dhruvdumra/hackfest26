import { useEffect, useMemo, useState } from 'react'
import { MOCK_AGENT_EVENTS } from '../data/mockAgentEvents.js'
import {
  createAgentStreamAdapter,
  getAgentStreamSource,
  normalizeAgentEvent,
} from '../domain/agentEvents.js'

const EMPTY_EVENTS = Array.from({ length: 0 })

function createMockSubscription({
  events = MOCK_AGENT_EVENTS,
  intervalMs = 900,
} = {}) {
  return (onEvent) => {
    let eventIndex = 0
    let timerId
    let stopped = false

    const emitNextEvent = () => {
      if (stopped || eventIndex >= events.length) {
        return
      }

      onEvent(events[eventIndex])
      eventIndex += 1

      if (!stopped && eventIndex < events.length) {
        timerId = setTimeout(emitNextEvent, intervalMs)
      }
    }

    timerId = setTimeout(emitNextEvent, 0)

    return () => {
      stopped = true
      clearTimeout(timerId)
    }
  }
}

export function createMockAgentAdapter(options = {}) {
  return createAgentStreamAdapter({
    source: 'simulated',
    subscribe: createMockSubscription(options),
  })
}

const defaultMockAdapter = createMockAgentAdapter()

/**
 * Subscribe to an agent event stream.
 *
 * `enabled` gates the subscription itself. The page used to subscribe on mount,
 * so the recorded demo run started playing before anyone pressed Run pipeline
 * and the presenter lost the moment the judges were meant to see. A disabled
 * stream reports no events and holds no timer; the presenter enables it, and a
 * new `sessionId` replays the run from the start.
 */
export function useAgentStream({
  adapter = defaultMockAdapter,
  sessionId = 'demo-session',
  enabled = true,
} = {}) {
  const source = getAgentStreamSource(adapter)
  const streamId = `${source}:${sessionId}`
  const streamIdentity = useMemo(
    () => ({ adapter, sessionId, streamId }),
    [adapter, sessionId, streamId],
  )
  const [streamState, setStreamState] = useState(() => ({
    streamIdentity,
    events: EMPTY_EVENTS,
  }))
  const stateIsCurrent = streamState.streamIdentity === streamIdentity

  useEffect(() => {
    if (!enabled) {
      return undefined
    }

    let active = true
    const unsubscribe = adapter.subscribe((event) => {
      if (!active) {
        return
      }

      setStreamState((currentState) => {
        const normalizedEvent = normalizeAgentEvent(event, {
          streamId,
          receivedAt: Date.now(),
        })

        if (currentState.streamIdentity !== streamIdentity) {
          return {
            streamIdentity,
            events: [normalizedEvent],
          }
        }

        const duplicateExists = currentState.events.some(
          (currentEvent) =>
            currentEvent.deduplicationKey === normalizedEvent.deduplicationKey,
        )

        if (duplicateExists) {
          return currentState
        }

        return {
          ...currentState,
          events: [...currentState.events, normalizedEvent],
        }
      })
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [adapter, enabled, sessionId, streamId, streamIdentity])

  return {
    events: enabled && stateIsCurrent ? streamState.events : EMPTY_EVENTS,
    source,
  }
}
