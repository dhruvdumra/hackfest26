/* The skills graph's nodes, as the backend's bundled fixture names them
 * (backend/app/mocks/hana_fixtures.py). GET /route accepts only these as
 * `from_skill`, and the orchestrator starts a route from the first passport
 * claim that is one of them. */
export const SKILL_OPTIONS = [
  'Manual testing',
  'Regression testing',
  'API testing',
  'Test automation',
  'SQL data validation',
  'CI maintenance',
  'QA analytics',
  'Stakeholder communication',
  'Requirements analysis',
  'Defect triage',
  'Release verification',
  'Defect analytics',
]
