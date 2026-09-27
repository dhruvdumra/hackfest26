/* Display names for the backend's role ids, copied from the `title` of each
 * profile in backend/app/mocks/role_fixtures.py. The ids stay the values sent
 * to the API; these are what a judge reads instead of `qa-analyst`. */
const ROLE_NAMES = {
  'api-test-engineer': 'API Test Engineer',
  'business-analyst': 'Business Systems Analyst',
  'compatibility-test-lead': 'Compatibility Test Lead',
  'data-quality-analyst': 'Data Quality Analyst',
  'manual-testing-technician': 'Manual Testing Technician',
  'mobile-qa-engineer': 'Mobile QA Engineer',
  'performance-test-engineer': 'Performance Test Engineer',
  'product-analyst': 'Product Analyst',
  'qa-analyst': 'QA Analyst',
  'qa-automation-engineer': 'Test Automation Engineer',
  'qa-test-associate': 'QA Test Associate',
  'quality-analyst': 'Software Quality Analyst',
  sdet: 'Software Development Engineer in Test',
  'support-operations-lead': 'Support Operations Lead',
  'test-manager': 'Test Manager',
}

/** The role's display name, or the id itself when the catalogue has no entry. */
export function roleName(roleId) {
  return ROLE_NAMES[roleId] ?? roleId
}
