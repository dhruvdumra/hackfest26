import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const decideConsentMock = vi.fn()

vi.mock('../api.js', () => ({
  decideConsent: (...args) => decideConsentMock(...args),
}))

const { default: ConsentCard } = await import('./ConsentCard.jsx')
const { readConsent } = await import('../domain/consent.js')

const BIAS_DONE = { agent: 'BIAS AUDIT', status: 'done', message: 'PASS', data: null }
const WAITING = {
  agent: 'ORCHESTRATOR',
  status: 'waiting_consent',
  message: 'Waiting for Kavya: share her Skill Passport with employers?',
  data: { blocking: true },
}
const doneWith = (consent) => ({
  agent: 'ORCHESTRATOR',
  status: 'done',
  message: 'closed',
  data: { consent, terminal: true },
})

describe('readConsent', () => {
  it('is idle until the orchestrator asks', () => {
    expect(readConsent([BIAS_DONE])).toBe('idle')
  })

  it('is waiting once the orchestrator asks', () => {
    expect(readConsent([BIAS_DONE, WAITING])).toBe('waiting')
  })

  it('takes the answer from the closing event', () => {
    expect(readConsent([WAITING, doneWith('accepted')])).toBe('accepted')
    expect(readConsent([WAITING, doneWith('declined')])).toBe('declined')
    expect(readConsent([WAITING, doneWith('timed_out')])).toBe('timed_out')
  })
})

describe('ConsentCard', () => {
  beforeEach(() => {
    decideConsentMock.mockReset()
  })

  it('renders nothing before the orchestrator asks', () => {
    const { container } = render(<ConsentCard events={[BIAS_DONE]} live sessionId="s-1" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('asks Kavya the question with a yes and a no', () => {
    render(<ConsentCard events={[WAITING]} live sessionId="s-1" />)

    expect(
      screen.getByRole('heading', { name: 'Share Kavya’s Skill Passport with employers?' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Yes, share it' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'No, keep it private' })).toBeEnabled()
  })

  it('sends a live answer to the backend', async () => {
    decideConsentMock.mockResolvedValue({ consent: 'accepted' })
    render(<ConsentCard events={[WAITING]} live sessionId="s-1" baseUrl="http://api" />)

    fireEvent.click(screen.getByRole('button', { name: 'Yes, share it' }))

    await waitFor(() => {
      expect(decideConsentMock).toHaveBeenCalledWith('s-1', true, { baseUrl: 'http://api' })
    })
    expect(screen.getByText('Recording Kavya’s answer…')).toBeInTheDocument()
  })

  it('shows the answer the backend recorded', () => {
    render(<ConsentCard events={[WAITING, doneWith('declined')]} live sessionId="s-1" />)

    expect(screen.getByText('Kavya said no. Her Skill Passport stays private.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Yes, share it' })).toBeNull()
  })

  it('says so when nobody answered in time', () => {
    render(<ConsentCard events={[WAITING, doneWith('timed_out')]} live sessionId="s-1" />)

    expect(screen.getByText('No answer came in time, so nothing was shared.')).toBeInTheDocument()
  })

  it('keeps a demo-mode answer on this screen and says nothing was sent', () => {
    const onLocalDecision = vi.fn()
    render(<ConsentCard events={[WAITING]} live={false} onLocalDecision={onLocalDecision} />)

    fireEvent.click(screen.getByRole('button', { name: 'No, keep it private' }))

    expect(decideConsentMock).not.toHaveBeenCalled()
    expect(onLocalDecision).toHaveBeenCalledWith('declined')
  })

  it('labels a demo-mode outcome as not sent', () => {
    render(<ConsentCard events={[WAITING, doneWith('accepted')]} live={false} />)

    expect(screen.getByText('demo mode · not sent')).toBeInTheDocument()
  })

  it('lets the presenter try again when the answer could not be recorded', async () => {
    decideConsentMock.mockRejectedValue(new Error('network down'))
    render(<ConsentCard events={[WAITING]} live sessionId="s-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Yes, share it' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kavya’s answer could not be recorded. Try again.',
    )
    expect(screen.getByRole('button', { name: 'Yes, share it' })).toBeEnabled()
  })

  it('explains a 409 instead of asking for a retry', async () => {
    decideConsentMock.mockRejectedValue(Object.assign(new Error('conflict'), { status: 409 }))
    render(<ConsentCard events={[WAITING]} live sessionId="s-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'No, keep it private' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This run is no longer waiting for an answer.',
    )
  })
})
