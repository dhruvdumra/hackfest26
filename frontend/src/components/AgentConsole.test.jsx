import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AgentConsole from './AgentConsole.jsx'
import { MOCK_AGENT_EVENTS } from '../data/mockAgentEvents.js'
import { normalizeAgentEvent } from '../domain/agentEvents.js'

const PIPELINE_AGENTS = [
  'SKILLS DISCOVERY',
  'MARKET INTELLIGENCE',
  'LEARNING PATHWAY',
  'INCLUSIVE MATCHING',
  'EMPLOYER READINESS',
  'BIAS AUDIT',
]

function normalizeAll(events) {
  return events.map((event, index) =>
    normalizeAgentEvent(event, { streamId: 'test', receivedAt: 1_700_000_000_000 + index }),
  )
}

function getRail() {
  return within(screen.getByRole('list', { name: 'Pipeline agents reporting' })).getAllByRole(
    'listitem',
  )
}

describe('AgentConsole', () => {
  it('shows an idle state with no log rows before a run starts', () => {
    render(<AgentConsole />)

    expect(screen.getByText(/No session open/)).toBeInTheDocument()
    expect(screen.getByText('0 events')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Agent event stream' })).toBeNull()
  })

  it('prints each event as a row with its agent, status time and message', () => {
    const events = normalizeAll(MOCK_AGENT_EVENTS.slice(0, 3))
    render(<AgentConsole events={events} />)

    const log = screen.getByRole('list', { name: 'Agent event stream' })
    expect(within(log).getAllByRole('listitem')).toHaveLength(3)
    // Skills Discovery opens its stage with `running` and closes it with `done`,
    // so its name legitimately appears on two of the three rows.
    expect(within(log).getAllByText('SKILLS DISCOVERY')).toHaveLength(2)
    expect(within(log).getByText('Session opened for Kavya · 7 agents queued')).toBeInTheDocument()
    expect(within(log).getByText('00:00')).toBeInTheDocument()
  })

  it('caps the visible rows but reports the true event total', () => {
    const events = normalizeAll(MOCK_AGENT_EVENTS)
    // MOCK_AGENT_EVENTS is 14 events and the cap is 7, so this also proves the cap is below the
    // fixture length rather than coincidentally equal to it.
    expect(events.length).toBeGreaterThan(10)

    render(<AgentConsole events={events} />)

    const log = screen.getByRole('list', { name: 'Agent event stream' })
    expect(within(log).getAllByRole('listitem')).toHaveLength(7)
    expect(screen.getByText(`${events.length} events`)).toBeInTheDocument()
    // The newest event survives the cap; the oldest does not.
    expect(
      within(log).getByText('Waiting for Kavya: share her Skill Passport with employers?'),
    ).toBeInTheDocument()
    expect(within(log).queryByText('Session opened for Kavya · 7 agents queued')).toBeNull()
  })

  it('fills a rail tick only for agents that have reported done', () => {
    const events = normalizeAll(
      MOCK_AGENT_EVENTS.filter(
        (event) =>
          event.agent === 'SKILLS DISCOVERY' && event.status === 'done',
      ),
    )
    render(<AgentConsole events={events} />)

    const rail = getRail()
    expect(rail).toHaveLength(PIPELINE_AGENTS.length)

    // The tick is an aria-hidden hairline, so it is read by class rather than by
    // role: the first agent has reported, so its tick is the Chalk one.
    const skillsTick = rail[0].querySelector('span')
    expect(skillsTick).toHaveClass('bg-chalk')
    const marketTick = rail[1].querySelector('span')
    expect(marketTick).toHaveClass('bg-graphite')
  })

  it('does not count an agent that reported running but never done', () => {
    const events = normalizeAll(
      MOCK_AGENT_EVENTS.filter(
        (event) =>
          event.agent === 'LEARNING PATHWAY' && event.status === 'running',
      ),
    )
    render(<AgentConsole events={events} />)

    expect(screen.getByText('0/6 agents done')).toBeInTheDocument()
  })

  it('counts each agent once regardless of how many times it reported', () => {
    const events = normalizeAll(
      MOCK_AGENT_EVENTS.filter(
        (event) =>
          event.agent === 'SKILLS DISCOVERY' && event.status === 'done',
      ),
    )
    // Two `done` events for the same agent — the orchestrator emits running+done
    // for every stage, so duplicates are the normal case, not an edge case.
    render(
      <AgentConsole
        events={[...events, ...events.map((event) => ({ ...event, id: `${event.id}-b` }))]}
      />,
    )

    expect(screen.getByText('1/6 agents done')).toBeInTheDocument()
  })

  it('never counts the orchestrator, which is not one of the six rail agents', () => {
    // The orchestrator reports `done` once Kavya answers, and is deliberately
    // absent from the rail. Counting it put the footer at "7/6 agents done" on a
    // finished run, disagreeing with the six ticks directly above it.
    const events = normalizeAll([
      ...MOCK_AGENT_EVENTS,
      { agent: 'ORCHESTRATOR', status: 'done', message: 'Kavya said yes', timestamp: '00:15' },
    ])
    expect(
      events.some((event) => event.agent === 'ORCHESTRATOR' && event.status === 'done'),
    ).toBe(true)

    render(<AgentConsole events={events} />)

    expect(screen.getByText('6/6 agents done')).toBeInTheDocument()
    expect(screen.queryByText(/7\/6/)).toBeNull()
  })

  it('reports the streaming state instead of the idle one', () => {
    render(<AgentConsole isStreaming />)

    expect(screen.getByText('streaming')).toBeInTheDocument()
    expect(screen.queryByText(/No session open/)).toBeNull()
  })

  it('renders an unknown status without borrowing the run live cue', () => {
    const events = normalizeAll([
      { agent: 'SOME AGENT', status: 'quantum_flux', message: 'New backend status' },
    ])
    render(<AgentConsole events={events} />)

    const log = screen.getByRole('list', { name: 'Agent event stream' })
    const dot = within(log).getAllByRole('listitem')[0].querySelector('span')
    expect(dot).toHaveClass('border-graphite')
    expect(dot).not.toHaveClass('bg-chalk')
  })

  it('announces new events politely rather than as an alert', () => {
    render(<AgentConsole events={normalizeAll(MOCK_AGENT_EVENTS.slice(0, 1))} />)

    const log = screen.getByRole('list', { name: 'Agent event stream' })
    expect(log).toHaveAttribute('aria-live', 'polite')
    expect(log).toHaveAttribute('aria-relevant', 'additions')
  })
})
