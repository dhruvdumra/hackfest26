import { describe, expect, it } from 'vitest'
import { MOCK_AGENT_EVENTS } from './mockAgentEvents.js'

// The offline run is what the room sees in demo mode, so it has to tell the
// same story as the backend and the pitch deck.
describe('MOCK_AGENT_EVENTS', () => {
  it('runs the six agents in the backend order, each opening and closing once', () => {
    const agents = MOCK_AGENT_EVENTS.filter((event) => event.agent !== 'ORCHESTRATOR')

    expect(agents.map((event) => `${event.agent}:${event.status}`)).toEqual([
      'SKILLS DISCOVERY:running',
      'SKILLS DISCOVERY:done',
      'MARKET INTELLIGENCE:running',
      'MARKET INTELLIGENCE:done',
      'LEARNING PATHWAY:running',
      'LEARNING PATHWAY:done',
      'INCLUSIVE MATCHING:running',
      'INCLUSIVE MATCHING:done',
      'EMPLOYER READINESS:running',
      'EMPLOYER READINESS:done',
      'BIAS AUDIT:running',
      'BIAS AUDIT:done',
    ])
  })

  it('ends by asking Kavya, not by answering for her', () => {
    const last = MOCK_AGENT_EVENTS.at(-1)

    expect(last.agent).toBe('ORCHESTRATOR')
    expect(last.status).toBe('waiting_consent')
  })

  it('quotes the numbers the pitch deck shows', () => {
    const doneMessage = (agent) =>
      MOCK_AGENT_EVENTS.find((event) => event.agent === agent && event.status === 'done').message

    expect(doneMessage('SKILLS DISCOVERY')).toMatch(/^8 skill claims .* 2 awaiting proof/)
    expect(doneMessage('MARKET INTELLIGENCE')).toMatch(/^4 .*radar rows · 28 openings in Chennai$/)
    expect(doneMessage('LEARNING PATHWAY')).toBe('45 bridge hours · 3 skills · 4.5 weeks at 10h')
    expect(doneMessage('INCLUSIVE MATCHING')).toMatch(/^3 ranked matches .* 0 blocked/)
    expect(doneMessage('EMPLOYER READINESS')).toMatch(/^12 previously hidden .* 1 rewritten/)
    expect(doneMessage('BIAS AUDIT')).toBe('PASS · maximum score delta 0 points')
  })
})
