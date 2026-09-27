import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runMatchMock = vi.fn()

vi.mock('../api.js', () => ({
  runMatch: (payload, options) => runMatchMock(payload, options),
}))

const { default: MatchPanel } = await import('./MatchPanel.jsx')

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function role(roleId, title, payDelta, overrides = {}) {
  return {
    role: roleId,
    role_id: roleId,
    title,
    score: 0.5,
    similarity: 0.5,
    pay_delta_pct: payDelta,
    annual_pay: 400000,
    commute_km: 18,
    blocked_by_guardrail: false,
    guardrail_reason: null,
    source: 'simulated',
    ...overrides,
  }
}

const ALLOWED = [
  role('qa-analyst', 'QA Analyst', -6.1, { score: 0.671 }),
  role('quality-analyst', 'Software Quality Analyst', 6.1),
  role('data-quality-analyst', 'Data Quality Analyst', 18.2),
  role('qa-automation-engineer', 'Test Automation Engineer', 78.8),
  role('mobile-qa-engineer', 'Mobile QA Engineer', 66.7),
  role('sdet', 'Software Development Engineer in Test', 119.7),
]

const BLOCKED = [
  role('manual-testing-technician', 'Manual Testing Technician', -36.4, {
    blocked_by_guardrail: true,
    guardrail_reason: 'Pay cut of 36.4% exceeds the 15% wage-scar guardrail',
  }),
]

function response(matches) {
  return {
    passport_id: 'kavya-baseline',
    matches,
    source: 'simulated',
    guardrail_threshold_pct: 15,
  }
}

describe('MatchPanel', () => {
  beforeEach(() => {
    runMatchMock.mockReset()
    runMatchMock.mockResolvedValue(response([...ALLOWED, ...BLOCKED]))
  })

  it('ranks the baseline passport before a session exists', async () => {
    render(<MatchPanel />)

    expect(await screen.findByText('7 roles ranked · 1 blocked · guardrail 15%')).toBeInTheDocument()
    expect(runMatchMock).toHaveBeenCalledWith(
      {
        passport_id: 'kavya-baseline',
        session_id: null,
        constraints: { accept_pay_cut: false },
      },
      expect.objectContaining({ baseUrl: '' }),
    )
    expect(screen.getByText('baseline passport · no session yet')).toBeInTheDocument()
  })

  it('keeps a blocked role in view with the server reason, not colour alone', async () => {
    render(<MatchPanel />)

    const row = (await screen.findByText('Manual Testing Technician')).closest('tr')
    expect(row).not.toBeNull()
    const blockedRow = /** @type {HTMLElement} */ (row)

    expect(within(blockedRow).getByText('Blocked')).toBeInTheDocument()
    expect(within(blockedRow).getByText('-36.4%')).toBeInTheDocument()
    expect(
      within(blockedRow).getByText('Pay cut of 36.4% exceeds the 15% wage-scar guardrail'),
    ).toBeInTheDocument()
  })

  it('matches the session passport once the skills agent has written one', async () => {
    render(<MatchPanel sessionId="session-1" passportId="passport-session-1" />)

    await waitFor(() =>
      expect(runMatchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          passport_id: 'passport-session-1',
          session_id: 'session-1',
        }),
        expect.anything(),
      ),
    )
    expect(await screen.findByText('passport passport-session-1')).toBeInTheDocument()
  })

  it('re-ranks with the pay-cut opt-in, which is the only way to lift the block', async () => {
    render(<MatchPanel />)
    await screen.findByText('Manual Testing Technician')

    runMatchMock.mockResolvedValue(
      response([
        ...ALLOWED,
        { ...BLOCKED[0], blocked_by_guardrail: false, guardrail_reason: null },
      ]),
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /Accept a pay cut/ }))

    await waitFor(() =>
      expect(runMatchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ constraints: { accept_pay_cut: true } }),
        expect.anything(),
      ),
    )
    expect(await screen.findByText('7 roles ranked · 0 blocked · guardrail 15%')).toBeInTheDocument()
  })

  it('folds the long tail of allowed roles but never the blocked ones', async () => {
    render(<MatchPanel />)
    await screen.findByText('Manual Testing Technician')

    expect(screen.queryByText('Software Development Engineer in Test')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 more roles' }))

    expect(screen.getByText('Software Development Engineer in Test')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show fewer roles' })).toBeInTheDocument()
  })

  it('says so when the matching service cannot be reached', async () => {
    runMatchMock.mockRejectedValue(
      new ApiError('ReRoute could not reach the backend at http://127.0.0.1:8000/match.', 0),
    )
    render(<MatchPanel />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'ReRoute could not reach the backend',
    )
  })
})
