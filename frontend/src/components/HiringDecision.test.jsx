import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const decideMock = vi.fn()
const latestMock = vi.fn()

vi.mock('../api.js', () => ({
  decideEmployerRewrite: (jobPostId, payload, options) => decideMock(jobPostId, payload, options),
  getEmployerDecision: (jobPostId, options) => latestMock(jobPostId, options),
}))

const { default: HiringDecision } = await import('./HiringDecision.jsx')

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const POST_ID = 'post-chennai-qa-analyst-118'

function record(decision, overrides = {}) {
  return {
    decision_id: `decision-${decision}`,
    job_post_id: POST_ID,
    decision,
    reviewer: 'Priya (HR)',
    note: null,
    decided_at: '2026-09-27T10:15:00Z',
    hidden_talent_count: 12,
    source: 'simulated',
    ...overrides,
  }
}

describe('HiringDecision', () => {
  beforeEach(() => {
    decideMock.mockReset()
    latestMock.mockReset()
    latestMock.mockRejectedValue(new ApiError('No decision has been recorded', 404))
  })

  it('asks for a human sign-off when nobody has decided yet', async () => {
    render(<HiringDecision jobPostId={POST_ID} hiddenTalentCount={12} />)

    expect(await screen.findByRole('button', { name: 'Approve rewrite' })).toBeEnabled()
    expect(screen.getByText('Publish the rewritten post?')).toBeInTheDocument()
    expect(screen.getByText(/reaches 12 candidates the old filter hid/)).toBeInTheDocument()
    // No decision yet is a 404, and it must not read as an error.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('records an approval with the reviewer name and shows the receipt', async () => {
    decideMock.mockResolvedValue(record('approve'))
    render(<HiringDecision jobPostId={POST_ID} hiddenTalentCount={12} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Signed by' }), {
      target: { value: 'Priya (HR)' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Approve rewrite' }))

    await waitFor(() =>
      expect(decideMock).toHaveBeenCalledWith(
        POST_ID,
        { decision: 'approve', reviewer: 'Priya (HR)' },
        { baseUrl: '' },
      ),
    )
    expect(await screen.findByText('Approved by Priya (HR)')).toBeInTheDocument()
    expect(screen.getByText(/decision-approve/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve rewrite' })).toBeNull()
  })

  it('shows a stored decision on load and lets a person record a reversal', async () => {
    latestMock.mockResolvedValue(record('approve'))
    decideMock.mockResolvedValue(record('reject', { decision_id: 'decision-second' }))
    render(<HiringDecision jobPostId={POST_ID} />)

    expect(await screen.findByText('Approved by Priya (HR)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Change decision' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    expect(await screen.findByText('Rejected by Priya (HR)')).toBeInTheDocument()
    expect(screen.getByText(/decision-second/)).toBeInTheDocument()
  })

  it('reports a failed save and keeps the buttons usable', async () => {
    decideMock.mockRejectedValue(
      new ApiError('ReRoute could not reach the backend at http://127.0.0.1:8000.', 0),
    )
    render(<HiringDecision jobPostId={POST_ID} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('could not reach the backend')
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
  })
})
