import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const decideConsentMock = vi.fn()

vi.mock('../api.js', () => ({
  decideConsent: (sessionId, payload, options) => decideConsentMock(sessionId, payload, options),
}))

const { default: ConsentCard } = await import('./ConsentCard.jsx')

const WAITING_EVENT = {
  agent: 'ORCHESTRATOR',
  status: 'waiting_consent',
  message: 'Confirm the two keys: evidence disclosure and the re-routed plan',
}

const PENDING_SESSION = {
  session_id: 'session-1',
  status: 'waiting',
  state: {
    consent: {
      state: 'pending',
      purpose: 'Share the verified skills with shortlisted employers',
      keys: ['evidence_disclosure', 'plan_acceptance'],
    },
  },
}

function receipt(decision, overrides = {}) {
  return {
    receipt_id: `consent-${decision}`,
    session_id: 'session-1',
    decision,
    state: decision === 'approve' ? 'approved' : 'revoked',
    actor: 'Kavya',
    purpose: 'Share the verified skills with shortlisted employers',
    keys: ['evidence_disclosure', 'plan_acceptance'],
    decided_at: '2026-09-27T10:15:00Z',
    session_status: 'completed',
    source: 'local',
    ...overrides,
  }
}

describe('ConsentCard', () => {
  beforeEach(() => {
    decideConsentMock.mockReset()
  })

  it('offers no decision until the orchestrator asks for one', () => {
    render(<ConsentCard />)

    expect(screen.getByText('The orchestrator has not asked yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve as Kavya' })).toBeNull()
  })

  it('asks Kavya once the stream reports the consent wait, and names what is shared', () => {
    render(<ConsentCard events={[WAITING_EVENT]} />)

    expect(
      screen.getByText('Share Kavya’s Skill Passport with shortlisted employers?'),
    ).toBeInTheDocument()
    expect(screen.getByText(/Never shared: her full CV, her voice note/)).toBeInTheDocument()
    expect(screen.getByText('waiting for Kavya')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve as Kavya' })).toBeEnabled()
  })

  it('records the approval on the server and shows the receipt', async () => {
    decideConsentMock.mockResolvedValue(receipt('approve'))
    const onDecided = vi.fn()
    render(
      <ConsentCard
        sessionId="session-1"
        session={PENDING_SESSION}
        onDecided={onDecided}
      />,
    )

    expect(
      screen.getByText('Purpose · Share the verified skills with shortlisted employers'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve as Kavya' }))

    await waitFor(() =>
      expect(decideConsentMock).toHaveBeenCalledWith(
        'session-1',
        { decision: 'approve', actor: 'Kavya' },
        { baseUrl: '' },
      ),
    )
    expect(await screen.findByText('Kavya approved sharing her passport.')).toBeInTheDocument()
    expect(screen.getByText(/Receipt consent-approve/)).toBeInTheDocument()
    expect(screen.getByText('local')).toBeInTheDocument()
    expect(onDecided).toHaveBeenCalledTimes(1)
  })

  it('lets Kavya revoke what she approved', async () => {
    decideConsentMock.mockResolvedValue(receipt('revoke', { receipt_id: 'consent-second' }))
    render(
      <ConsentCard
        sessionId="session-1"
        session={{
          ...PENDING_SESSION,
          state: {
            consent: { ...PENDING_SESSION.state.consent, state: 'approved' },
            consent_receipts: [receipt('approve')],
          },
        }}
      />,
    )

    expect(screen.getByText('Kavya approved sharing her passport.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke consent' }))

    expect(await screen.findByText('Kavya’s passport is not shared.')).toBeInTheDocument()
    expect(decideConsentMock).toHaveBeenCalledWith(
      'session-1',
      { decision: 'revoke', actor: 'Kavya' },
      { baseUrl: '' },
    )
    expect(screen.getByRole('button', { name: 'Give consent again' })).toBeInTheDocument()
  })

  it('keeps a decision on screen only, and says so, when there is no backend session', () => {
    render(<ConsentCard events={[WAITING_EVENT]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve as Kavya' }))

    expect(decideConsentMock).not.toHaveBeenCalled()
    expect(screen.getByText('Kavya approved sharing her passport.')).toBeInTheDocument()
    expect(screen.getByText('simulated · not saved')).toBeInTheDocument()
    expect(screen.getByText(/kept on this screen only/)).toBeInTheDocument()
  })

  it('reports a failed save without inventing a receipt', async () => {
    decideConsentMock.mockRejectedValue(new Error('Consent is already approved'))
    render(<ConsentCard sessionId="session-1" session={PENDING_SESSION} />)

    fireEvent.click(screen.getByRole('button', { name: 'Approve as Kavya' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Consent is already approved')
    expect(screen.queryByText(/Receipt/)).toBeNull()
  })
})
