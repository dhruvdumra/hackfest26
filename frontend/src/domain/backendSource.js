/**
 * The one line under the hero that says where this page's answers come from.
 *
 * It is read from GET /health rather than written by hand, so it can never
 * claim a service that is not answering: a service is named only when /health
 * reports it live and configured. Demo mode replays a recorded agent run, and
 * says so.
 *
 * @param {{ demoMode: boolean, health: any, backendBaseUrl: string }} input
 * @returns {{ label: string, live: boolean }}
 */
export function describeBackendSource({ demoMode, health, backendBaseUrl }) {
  if (demoMode) {
    return { label: 'Demo mode · replaying a recorded run', live: false }
  }

  if (health === null || health === undefined) {
    return { label: 'Checking the backend', live: false }
  }

  if (health === 'down' || typeof health !== 'object') {
    return { label: 'Backend unreachable', live: false }
  }

  const isLive = (service) =>
    service?.mode === 'live' && service?.integration_status === 'configured'
  const services = []

  if (isLive(health.hana)) {
    services.push('SAP HANA Cloud')
  }

  if (isLive(health.genai)) {
    services.push(health.genai.provider === 'gemini' ? 'Gemini' : 'SAP AI Core')
  }

  const onBtp = typeof backendBaseUrl === 'string' && backendBaseUrl.includes('.hana.ondemand.com')
  const host = onBtp ? 'Live on SAP BTP' : 'Live backend'

  return {
    label: services.length > 0 ? `${host} · ${services.join(' · ')}` : `${host} · sample data`,
    live: services.length > 0,
  }
}
