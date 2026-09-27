import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const scoreWorkSampleMock = vi.fn()

vi.mock('../api.js', () => ({
  scoreWorkSample: (payload) => scoreWorkSampleMock(payload),
}))

const { default: WorkSamplePanel } = await import('./WorkSamplePanel.jsx')

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const SKILLS = [
  { name: 'Manual testing', confidence: 0.91, verified: true },
  { name: 'Test automation', confidence: 0.42, verified: false },
]

describe('WorkSamplePanel', () => {
  beforeEach(() => {
    scoreWorkSampleMock.mockReset()
    scoreWorkSampleMock.mockResolvedValue({
      score: 88,
      credential_issued: true,
      source: 'simulated',
    })
  })

  it('asks for a passport before a sample can be scored', () => {
    render(<WorkSamplePanel />)

    expect(
      screen.getByText(
        'A skill is needed before a work sample can be scored. The passport has not landed yet.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Score work sample' })).toBeNull()
  })

  it('scores the picked work sample and renders the score, credential and source', async () => {
    const onScored = vi.fn()
    render(
      <WorkSamplePanel sessionId="session-1" skills={SKILLS} onScored={onScored} />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Skill to prove' }), {
      target: { value: 'Test automation' },
    })
    fireEvent.change(
      screen.getByRole('textbox', { name: 'Evidence submission' }),
      { target: { value: 'A Playwright suite that runs on every pull request.' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Score work sample' }))

    await waitFor(() => expect(scoreWorkSampleMock).toHaveBeenCalledTimes(1))
    expect(scoreWorkSampleMock).toHaveBeenCalledWith({
      skill_id: 'Test automation',
      submission: 'A Playwright suite that runs on every pull request.',
      session_id: 'session-1',
    })

    expect(await screen.findByText('88 out of 100')).toBeInTheDocument()
    expect(
      screen.getByText('Credential issued and recorded on the passport.'),
    ).toBeInTheDocument()
    expect(screen.getByText('simulated')).toBeInTheDocument()
    // The passport lives in step 01, so the panel asks App to re-read it.
    expect(onScored).toHaveBeenCalledTimes(1)
  })

  it('reports a rejected work sample without a credential', async () => {
    scoreWorkSampleMock.mockResolvedValue({
      score: 42,
      credential_issued: false,
      source: 'live',
    })
    render(<WorkSamplePanel sessionId="session-1" skills={SKILLS} />)

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Evidence submission' }),
      { target: { value: 'Notes from a manual pass only.' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Score work sample' }))

    expect(await screen.findByText('42 out of 100')).toBeInTheDocument()
    expect(
      screen.getByText('No credential issued. The score is below the server threshold.'),
    ).toBeInTheDocument()
    expect(screen.getByText('live')).toBeInTheDocument()
  })

  it('renders the ApiError message when the work sample request fails', async () => {
    scoreWorkSampleMock.mockRejectedValue(
      new ApiError('Session has no skill passport yet', 409),
    )
    render(<WorkSamplePanel sessionId="session-1" skills={SKILLS} />)

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Evidence submission' }),
      { target: { value: 'Anything at all.' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Score work sample' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Session has no skill passport yet',
    )
  })
})
