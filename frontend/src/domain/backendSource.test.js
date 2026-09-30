import { describe, expect, it } from 'vitest'
import { describeBackendSource } from './backendSource.js'

const LIVE = { mode: 'live', source: 'live', integration_status: 'configured' }
const MOCK = { mode: 'mock', source: 'simulated', integration_status: 'not_implemented' }
const BTP = 'https://reroute-backend-x.cfapps.us10-001.hana.ondemand.com'

describe('describeBackendSource', () => {
  it('says demo mode sends nothing', () => {
    expect(describeBackendSource({ demoMode: true, health: null, backendBaseUrl: BTP })).toEqual({
      label: 'Demo mode · replaying a recorded run',
      live: false,
    })
  })

  it('names only the services /health reports live and configured', () => {
    const health = { hana: LIVE, genai: { ...LIVE, provider: 'gemini' }, market: LIVE }

    expect(describeBackendSource({ demoMode: false, health, backendBaseUrl: BTP })).toEqual({
      label: 'Live on SAP BTP · SAP HANA Cloud · Gemini',
      live: true,
    })
  })

  it('never claims SAP AI Core or BTP it cannot see', () => {
    const health = { hana: LIVE, genai: MOCK, market: MOCK }

    expect(describeBackendSource({ demoMode: false, health, backendBaseUrl: '' }).label).toBe(
      'Live backend · SAP HANA Cloud',
    )
  })

  it('says sample data when nothing is live, and unreachable when /health fails', () => {
    const health = { hana: MOCK, genai: MOCK, market: MOCK }

    expect(describeBackendSource({ demoMode: false, health, backendBaseUrl: '' })).toEqual({
      label: 'Live backend · sample data',
      live: false,
    })
    expect(describeBackendSource({ demoMode: false, health: 'down', backendBaseUrl: '' }).label).toBe(
      'Backend unreachable',
    )
  })
})
