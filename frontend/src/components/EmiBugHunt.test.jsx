import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const scoreWorkSampleMock = vi.fn()

vi.mock('../api.js', () => ({
  scoreWorkSample: (payload, options) => scoreWorkSampleMock(payload, options),
}))

const { default: EmiBugHunt } = await import('./EmiBugHunt.jsx')

const SCORED = {
  score: 80,
  credential_issued: true,
  credential: 'Defect reproduction',
  bugs_found: [
    'Divides by zero at a 0% interest rate',
    'Reads a tenure in years as months',
    'Accepts a negative loan amount',
    'Drops the decimal part of the interest rate',
  ],
  bugs_total: 5,
  false_reports: 0,
  source: 'local',
}

describe('EmiBugHunt', () => {
  beforeEach(() => {
    scoreWorkSampleMock.mockReset()
    scoreWorkSampleMock.mockResolvedValue(SCORED)
  })

  it('runs the calculator live as the inputs change', () => {
    render(<EmiBugHunt />)

    expect(screen.getByTestId('emi-value')).toHaveTextContent('₹10,379')

    fireEvent.change(screen.getByLabelText('Interest rate (% a year)'), {
      target: { value: '0' },
    })

    expect(screen.getByTestId('emi-value')).toHaveTextContent('₹NaN')
  })

  it('logs a finding with the exact inputs on screen and the note', () => {
    render(<EmiBugHunt />)

    fireEvent.change(screen.getByLabelText('Interest rate (% a year)'), {
      target: { value: '8.5' },
    })
    const log = screen.getByRole('button', { name: 'Log this bug' })
    expect(log).toBeDisabled()

    fireEvent.change(screen.getByLabelText('What looks wrong with these inputs?'), {
      target: { value: '8.5% prices like 8%.' },
    })
    fireEvent.click(log)

    const list = screen.getByRole('list', { name: 'Logged bugs' })
    expect(within(list).getByText('₹5,00,000 · 8.5% · 60 months')).toBeInTheDocument()
    expect(within(list).getByText('8.5% prices like 8%.')).toBeInTheDocument()
    expect(screen.getByText('Bug report · 1 logged')).toBeInTheDocument()
  })

  it('submits the report for grading and shows what was proven', async () => {
    const onScored = vi.fn()
    render(<EmiBugHunt sessionId="session-1" onScored={onScored} />)

    fireEvent.click(screen.getByRole('button', { name: 'Load a recorded hunt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit bug report' }))

    await waitFor(() => expect(scoreWorkSampleMock).toHaveBeenCalledTimes(1))
    const [payload] = scoreWorkSampleMock.mock.calls[0]
    expect(payload.skill_id).toBe('emi-bug-hunt')
    expect(payload.session_id).toBe('session-1')
    expect(JSON.parse(payload.submission)).toMatchObject({
      sample: 'emi-bug-hunt',
      findings: expect.arrayContaining([
        expect.objectContaining({ annual_rate: 0, tenure_unit: 'months' }),
      ]),
    })

    expect(await screen.findByText('80 / 100')).toBeInTheDocument()
    expect(screen.getByText('4 of 5 planted bugs reproduced · 0 false reports')).toBeInTheDocument()
    expect(screen.getByText('Credential · Defect reproduction')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Bugs reproduced' })).toHaveTextContent(
      'Drops the decimal part of the interest rate',
    )
    expect(onScored).toHaveBeenCalledTimes(1)
  })

  it('says how many bugs are still hidden when the report falls short', async () => {
    scoreWorkSampleMock.mockResolvedValue({
      ...SCORED,
      score: 30,
      credential_issued: false,
      credential: undefined,
      bugs_found: ['Accepts a negative loan amount', 'Reads a tenure in years as months'],
      false_reports: 1,
    })
    render(<EmiBugHunt />)

    fireEvent.click(screen.getByRole('button', { name: 'Load a recorded hunt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit bug report' }))

    expect(await screen.findByText('No credential yet')).toBeInTheDocument()
    expect(screen.getByText(/3 planted bugs are still hidden/)).toBeInTheDocument()
    expect(screen.getByText(/1 false report$/)).toBeInTheDocument()
  })

  it('reports a failed submission without inventing a score', async () => {
    scoreWorkSampleMock.mockRejectedValue(new Error('ReRoute could not reach the backend'))
    render(<EmiBugHunt />)

    fireEvent.click(screen.getByRole('button', { name: 'Load a recorded hunt' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit bug report' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('could not reach the backend')
    expect(screen.queryByTestId('bug-hunt-result')).toBeNull()
  })
})
