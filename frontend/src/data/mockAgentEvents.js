// Offline copy of one real backend run for Kavya (mock settings), message for
// message and in the backend's order. The pitch deck quotes these numbers, so
// if a backend change alters one, re-run the pipeline and update this and the deck.
// It stops where the backend does: waiting for Kavya's Two-Key answer, which the
// consent card then closes on screen.
export const MOCK_AGENT_EVENTS = [
  {
    agent: 'ORCHESTRATOR',
    status: 'running',
    message: 'Session opened for Kavya · 7 agents queued',
    timestamp: '00:00',
  },
  {
    agent: 'SKILLS DISCOVERY',
    status: 'running',
    message: 'Reading transcript for durable skill signals',
    timestamp: '00:01',
  },
  {
    agent: 'SKILLS DISCOVERY',
    status: 'done',
    message: '8 skill claims extracted · 2 awaiting proof evidence',
    timestamp: '00:03',
  },
  {
    agent: 'MARKET INTELLIGENCE',
    status: 'running',
    message: 'Checking displacement exposure and paid bridge demand',
    timestamp: '00:04',
  },
  {
    agent: 'MARKET INTELLIGENCE',
    status: 'done',
    message: '4 simulated radar rows · 28 openings in Chennai',
    timestamp: '00:05',
  },
  {
    agent: 'LEARNING PATHWAY',
    status: 'running',
    message: 'Mapping transferable skills to target roles',
    timestamp: '00:06',
  },
  {
    agent: 'LEARNING PATHWAY',
    status: 'done',
    message: '45 bridge hours · 3 skills · 4.5 weeks at 10h',
    timestamp: '00:07',
  },
  {
    agent: 'INCLUSIVE MATCHING',
    status: 'running',
    message: 'Comparing role fit against fair-work constraints',
    timestamp: '00:08',
  },
  {
    agent: 'INCLUSIVE MATCHING',
    status: 'done',
    message: '3 ranked matches ready · 0 blocked by the guardrail',
    timestamp: '00:09',
  },
  {
    agent: 'EMPLOYER READINESS',
    status: 'running',
    message: 'Rewriting restrictive shortlist signals',
    timestamp: '00:10',
  },
  {
    agent: 'EMPLOYER READINESS',
    status: 'done',
    message: '12 previously hidden candidates surfaced across 1 rewritten posts',
    timestamp: '00:11',
  },
  {
    agent: 'BIAS AUDIT',
    status: 'running',
    message: 'Re-running matches across Ghost Twin variants',
    timestamp: '00:12',
  },
  {
    agent: 'BIAS AUDIT',
    status: 'done',
    message: 'PASS · maximum score delta 0 points',
    timestamp: '00:13',
  },
  {
    agent: 'ORCHESTRATOR',
    status: 'waiting_consent',
    message: 'Waiting for Kavya: share her Skill Passport with employers?',
    timestamp: '00:14',
    data: { blocking: true },
  },
]
