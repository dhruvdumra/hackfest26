/* The recorded demo run.
 *
 * These are the events the backend orchestrator emits for the Kavya transcript
 * with USE_MOCK_HANA and USE_MOCK_GENAI on, recorded from `run_orchestration`
 * and replayed here so demo mode shows the same run the panels below compute —
 * not a hand-written script whose numbers drift from them. Timestamps are the
 * elapsed time of the replay, in the deck's `00:00` style.
 *
 * The run ends where the real one stops: the orchestrator waiting for Kavya's
 * consent. The Two-Key step records the decision; nothing here pretends it has
 * already been given. */
export const MOCK_AGENT_EVENTS = [
  {
    agent: 'ORCHESTRATOR',
    status: 'running',
    message: 'Session opened for Kavya · 7 agents queued',
    timestamp: '00:00',
    sequence: 1,
  },
  {
    agent: 'SKILLS DISCOVERY',
    status: 'running',
    message: 'Reading transcript for durable skill signals',
    timestamp: '00:01',
    sequence: 2,
  },
  {
    agent: 'SKILLS DISCOVERY',
    status: 'done',
    message: '8 skill claims extracted · 2 awaiting proof evidence',
    timestamp: '00:04',
    sequence: 3,
  },
  {
    agent: 'MARKET INTELLIGENCE',
    status: 'running',
    message: 'Checking displacement exposure and paid bridge demand',
    timestamp: '00:05',
    sequence: 4,
  },
  {
    agent: 'MARKET INTELLIGENCE',
    status: 'done',
    message: '4 simulated radar rows · 28 openings in Chennai',
    timestamp: '00:06',
    sequence: 5,
  },
  {
    agent: 'LEARNING PATHWAY',
    status: 'running',
    message: 'Mapping transferable skills to target roles',
    timestamp: '00:07',
    sequence: 6,
  },
  {
    agent: 'LEARNING PATHWAY',
    status: 'done',
    message: '45 bridge hours · 3 skills · 4.5 weeks at 10h',
    timestamp: '00:08',
    sequence: 7,
  },
  {
    agent: 'INCLUSIVE MATCHING',
    status: 'running',
    message: 'Comparing role fit against fair-work constraints',
    timestamp: '00:09',
    sequence: 8,
  },
  {
    agent: 'INCLUSIVE MATCHING',
    status: 'done',
    message: '3 ranked matches ready · 0 blocked by the guardrail',
    timestamp: '00:10',
    sequence: 9,
  },
  {
    agent: 'EMPLOYER READINESS',
    status: 'running',
    message: 'Rewriting restrictive shortlist signals',
    timestamp: '00:11',
    sequence: 10,
  },
  {
    agent: 'EMPLOYER READINESS',
    status: 'done',
    message: '12 previously hidden candidates surfaced across 1 rewritten posts',
    timestamp: '00:12',
    sequence: 11,
  },
  {
    agent: 'BIAS AUDIT',
    status: 'running',
    message: 'Re-running matches across Ghost Twin variants',
    timestamp: '00:13',
    sequence: 12,
  },
  {
    agent: 'BIAS AUDIT',
    status: 'done',
    message: 'PASS · maximum score delta 0 points',
    timestamp: '00:14',
    sequence: 13,
  },
  {
    agent: 'ORCHESTRATOR',
    status: 'waiting_consent',
    message: 'Confirm the two keys: evidence disclosure and the re-routed plan',
    timestamp: '00:15',
    sequence: 14,
    data: { phase: 'two_key_wait', keys: ['evidence_disclosure', 'plan_acceptance'] },
  },
]
