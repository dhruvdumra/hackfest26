/* The five moments the jury sees, in the order the pitch deck promises them
 * (slide 9, "What the jury sees live"). The page is built in this order, the
 * presenter bar steps through it, and each `id` is the section anchor.
 *
 * Step 5 carries both human keys: Kavya's consent to share her passport, and
 * the hiring manager's sign-off on the rewritten job post. */
export const DEMO_MOMENTS = [
  {
    id: 'voice',
    label: 'Voice in',
    number: '01',
    eyebrow: 'Voice note in',
    title: 'Kavya says what she actually did.',
    description:
      'She speaks or types her work history in plain words. The Skills Discovery agent turns it into a Skill Passport: every claim with a confidence, and the ones that still need proof.',
  },
  {
    id: 'proof',
    label: 'Prove it',
    number: '02',
    eyebrow: 'Proof of skill',
    title: 'Real work beats a résumé.',
    description:
      'A claim becomes a credential only when the work is shown. The server scores the sample and decides whether the credential lands on her passport.',
  },
  {
    id: 'route',
    label: 'Route & match',
    number: '03',
    eyebrow: 'Route and fair match',
    title: 'A paid route, and only fair offers.',
    description:
      'How exposed her current role is, the shortest skill route to a growing one, and the roles she matches — with any that cut her pay past the guardrail blocked, and a reason for each.',
  },
  {
    id: 'audit',
    label: 'Ghost Twins',
    number: '04',
    eyebrow: 'Ghost Twin audit',
    title: 'Change one fact, and watch the score.',
    description:
      "Every ranking is re-scored against Ghost Twins that differ from Kavya in exactly one attribute. If a twin moves more than the server's threshold, the decision is flagged for a human.",
  },
  {
    id: 'keys',
    label: 'Two keys',
    number: '05',
    eyebrow: 'The Two-Key rule',
    title: 'AI proposes. A human decides.',
    description:
      'Nothing that touches her data, her job or her pay happens on an agent’s say-so. Kavya holds the first key to her passport; the hiring manager holds the second on the rewritten post.',
  },
]
