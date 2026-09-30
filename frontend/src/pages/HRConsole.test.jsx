import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HRConsole from './HRConsole.jsx'
import {
  decideEmployerRewrite,
  getEmployerDecision,
  rewriteEmployerFilter,
} from '../api.js'

vi.mock('../api.js', () => ({
  decideEmployerRewrite: vi.fn(),
  getEmployerDecision: vi.fn(),
  rewriteEmployerFilter: vi.fn(),
}))

const REWRITE_DISCLAIMER =
  'Illustrative employer job posts bundled with the demo, not observed hiring data.'

const REWRITE_ROW = {
  job_post_id: 'post-chennai-qa-analyst-118',
  role: 'qa-analyst',
  city: 'Chennai',
  filter_text_before:
    'Looking for a QA analyst. Must be a graduate from a tier-1 college, aged 22-28, and only consider candidates with no career break so far. Female candidates preferred for the floor walk.',
  filter_text_after:
    'Looking for a QA analyst with documented regression, defect triage and API testing evidence. A career break is fine as long as the evidence is current. Every applicant is scored on the same criteria.',
  restrictive_phrase: 'aged 22-28',
  removed_criteria: [
    'must be a graduate from a tier-1 college',
    'aged 22-28',
    'only consider candidates with no career break so far',
    'Female candidates preferred for the floor walk',
  ],
  hidden_talent_count: 12,
  rewrite_reason:
    'Age, college tier and gender wording removed; evidence replaced pedigree.',
  source: 'simulated',
  disclaimer: REWRITE_DISCLAIMER,
}

const LIVE_PATTERN = /\blive\b/i

function deferred() {
  let settle = (_value) => {}
  const promise = new Promise((resolve) => {
    settle = (value) => resolve(value)
  })

  return { promise, resolve: settle }
}

const rewriteMock = vi.mocked(rewriteEmployerFilter)
const decisionMock = vi.mocked(decideEmployerRewrite)
const latestDecisionMock = vi.mocked(getEmployerDecision)

describe('HRConsole hiring-manager sign-off', () => {
  beforeEach(() => {
    rewriteMock.mockReset()
    decisionMock.mockReset()
    latestDecisionMock.mockReset()
    rewriteMock.mockResolvedValue(REWRITE_ROW)
    latestDecisionMock.mockRejectedValue(Object.assign(new Error('none yet'), { status: 404 }))
  })

  it('shows a decision made earlier, such as in SAP Build Apps, and still asks again', async () => {
    latestDecisionMock.mockResolvedValue({
      job_post_id: 'post-chennai-qa-analyst-118',
      decision: 'approved',
      message: 'Published by hiring manager',
      decided_at: '2026-09-30T05:00:00+00:00',
    })
    render(<HRConsole baseUrl="http://api" />)

    // The earlier decision annotates the buttons instead of replacing them, so
    // a rehearsal approval never leaves the live demo with nothing to click.
    expect(await screen.findByTestId('rewrite-prior-decision')).toHaveTextContent(
      'Last recorded decision=approved',
    )
    expect(screen.getByRole('button', { name: 'Approve and publish' })).toBeEnabled()
    expect(latestDecisionMock).toHaveBeenCalledWith('post-chennai-qa-analyst-118', {
      baseUrl: 'http://api',
      signal: expect.any(AbortSignal),
    })
  })

  it('still asks for sign-off when there is no decision yet', async () => {
    render(<HRConsole />)
    await screen.findByTestId('hidden-talent-count')

    await waitFor(() => expect(latestDecisionMock).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Approve and publish' })).toBeEnabled()
    expect(screen.queryByTestId('rewrite-decision-error')).toBeNull()
  })

  it('asks the hiring manager to approve or reject the rewrite', async () => {
    render(<HRConsole />)

    await screen.findByTestId('hidden-talent-count')

    expect(screen.getByRole('button', { name: 'Approve and publish' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
  })

  it('publishes the rewrite on approval', async () => {
    decisionMock.mockResolvedValue({
      job_post_id: 'post-chennai-qa-analyst-118',
      decision: 'approved',
      message: 'Published by hiring manager',
      decided_at: '2026-09-30T05:00:00+00:00',
    })
    render(<HRConsole baseUrl="http://api" />)
    await screen.findByTestId('hidden-talent-count')

    fireEvent.click(screen.getByRole('button', { name: 'Approve and publish' }))

    expect(await screen.findByTestId('rewrite-decision')).toHaveTextContent(
      'Published by hiring manager',
    )
    expect(decisionMock).toHaveBeenCalledWith('post-chennai-qa-analyst-118', true, {
      baseUrl: 'http://api',
    })
    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
  })

  it('records a rejection', async () => {
    decisionMock.mockResolvedValue({
      job_post_id: 'post-chennai-qa-analyst-118',
      decision: 'rejected',
      message: 'Rejected by hiring manager · the rewrite is not published',
      decided_at: '2026-09-30T05:00:00+00:00',
    })
    render(<HRConsole />)
    await screen.findByTestId('hidden-talent-count')

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    expect(await screen.findByTestId('rewrite-decision')).toHaveTextContent(
      'Rejected by hiring manager',
    )
    expect(decisionMock).toHaveBeenCalledWith('post-chennai-qa-analyst-118', false, {
      baseUrl: '',
    })
  })

  it('lets the hiring manager decide again after a decision', async () => {
    decisionMock.mockResolvedValue({
      job_post_id: 'post-chennai-qa-analyst-118',
      decision: 'approved',
      message: 'Published by hiring manager',
      decided_at: '2026-09-30T05:00:00+00:00',
    })
    render(<HRConsole />)
    await screen.findByTestId('hidden-talent-count')

    fireEvent.click(screen.getByRole('button', { name: 'Approve and publish' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Decide again' }))

    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled()
    expect(screen.getByTestId('rewrite-prior-decision')).toHaveTextContent(
      'Last recorded decision=approved',
    )
  })

  it('keeps the buttons when the decision could not be recorded', async () => {
    decisionMock.mockRejectedValue(new Error('network down'))
    render(<HRConsole />)
    await screen.findByTestId('hidden-talent-count')

    fireEvent.click(screen.getByRole('button', { name: 'Approve and publish' }))

    expect(await screen.findByTestId('rewrite-decision-error')).toHaveTextContent('network down')
    expect(screen.getByRole('button', { name: 'Approve and publish' })).toBeEnabled()
  })

  it('does not ask for sign-off when the post hid nobody', async () => {
    rewriteMock.mockResolvedValue({ ...REWRITE_ROW, hidden_talent_count: 0 })
    render(<HRConsole />)
    await screen.findByTestId('hidden-talent-count')

    expect(screen.queryByRole('button', { name: 'Approve and publish' })).toBeNull()
  })
})

describe('HRConsole', () => {
  beforeEach(() => {
    rewriteMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the default rewrite on mount', async () => {
    rewriteMock.mockResolvedValue(REWRITE_ROW)

    render(<HRConsole />)

    await waitFor(() =>
      expect(rewriteMock).toHaveBeenCalledWith('post-chennai-qa-analyst-118', {
        baseUrl: '',
        signal: expect.any(AbortSignal),
      }),
    )
    expect(await screen.findByTestId('hidden-talent-count')).toHaveTextContent('12')
  })

  it('marks the rewrite with a Status Badge and never a live one', async () => {
    rewriteMock.mockResolvedValue(REWRITE_ROW)

    const { container } = render(<HRConsole />)
    await screen.findByTestId('hidden-talent-count')

    // The rewrite serves bundled sample posts, so its badge is the untinted
    // Iron outline, never the accent live dot.
    expect(screen.getByText('simulated').closest('span.rounded-badge')).toHaveClass('border-iron')
    expect(container.querySelectorAll('[data-status-dot]')).toHaveLength(1)
    container.querySelectorAll('[data-status-dot]').forEach((dot) => {
      expect(dot).not.toHaveClass('bg-pulse-green')
    })
    expect(screen.getAllByText('source=simulated')).toHaveLength(1)
    expect(container.textContent).not.toMatch(LIVE_PATTERN)
  })

  it('shows the rewrite disclaimer and says which data is sample data', async () => {
    rewriteMock.mockResolvedValue(REWRITE_ROW)

    render(<HRConsole />)

    expect(await screen.findByText(REWRITE_DISCLAIMER)).toBeInTheDocument()
    expect(screen.getByText('Job post rewrite:', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/hidden-talent counts here are sample data/)).toBeInTheDocument()
  })

  it('renders the before and after filter text with the restrictive phrase', async () => {
    rewriteMock.mockResolvedValue(REWRITE_ROW)

    render(<HRConsole />)

    const before = await screen.findByRole('heading', { name: 'Before · would be flagged' })
    const after = screen.getByRole('heading', { name: 'After · rewritten post' })

    expect(before.parentElement).toHaveTextContent(REWRITE_ROW.filter_text_before)
    expect(after.parentElement).toHaveTextContent(REWRITE_ROW.filter_text_after)
    expect(screen.getByTestId('restrictive-phrase')).toHaveTextContent(
      REWRITE_ROW.restrictive_phrase,
    )
    expect(screen.getByText('Restrictive phrase removed')).toBeInTheDocument()
    expect(screen.getByTestId('rewrite-reason')).toHaveTextContent(REWRITE_ROW.rewrite_reason)
  })

  it('lists every removed criterion', async () => {
    rewriteMock.mockResolvedValue(REWRITE_ROW)

    render(<HRConsole />)

    const list = await screen.findByRole('list', {
      name: `Criteria removed (${REWRITE_ROW.removed_criteria.length})`,
    })

    expect(within(list).getAllByRole('listitem')).toHaveLength(
      REWRITE_ROW.removed_criteria.length,
    )
    REWRITE_ROW.removed_criteria.forEach((criterion) => {
      expect(within(list).getByText(criterion)).toBeInTheDocument()
    })
  })

  it('surfaces a visible error when the employer post id is unknown', async () => {
    rewriteMock.mockRejectedValue(
      new Error('unknown job_post_id; expected one of: post-chennai-qa-analyst-118'),
    )

    render(<HRConsole />)

    const error = await screen.findByTestId('rewrite-error')

    expect(error).toHaveTextContent('Rewrite unavailable')
    expect(error).toHaveTextContent('unknown job_post_id')
    expect(screen.queryByTestId('hidden-talent-count')).not.toBeInTheDocument()
  })

  it('shows a loading state while the rewrite is in flight', async () => {
    const rewritePending = deferred()
    rewriteMock.mockReturnValue(rewritePending.promise)

    render(<HRConsole />)

    expect(await screen.findByTestId('rewrite-loading')).toHaveTextContent(
      'Rewriting the filter…',
    )
    expect(screen.getByRole('button', { name: 'Rewriting…' })).toBeDisabled()

    await act(async () => {
      rewritePending.resolve(REWRITE_ROW)
    })

    await waitFor(() =>
      expect(screen.queryByTestId('rewrite-loading')).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('hidden-talent-count')).toHaveTextContent('12')
  })

  it('falls back to an empty rewrite block when the fixture is empty', async () => {
    rewriteMock.mockResolvedValue({
      ...REWRITE_ROW,
      hidden_talent_count: 0,
      removed_criteria: [],
      restrictive_phrase: '',
      filter_text_after: '',
    })

    render(<HRConsole />)

    await screen.findByTestId('hidden-talent-count')
    expect(screen.getByTestId('hidden-talent-count')).toHaveTextContent('0')
    expect(screen.getByText('No criteria were removed from this post.')).toBeInTheDocument()
    expect(screen.getByText('No after text supplied.')).toBeInTheDocument()
    expect(screen.getByTestId('restrictive-phrase')).toHaveTextContent('no phrase reported')
  })

  it('shows an empty state when the rewrite resolves without data', async () => {
    rewriteMock.mockResolvedValue(undefined)

    render(<HRConsole />)

    expect(await screen.findByTestId('rewrite-empty')).toHaveTextContent('No rewrite yet')
    expect(screen.queryByTestId('hidden-talent-count')).not.toBeInTheDocument()
    expect(screen.getAllByText('simulated')).toHaveLength(1)
  })

  it('offers every bundled job post id and re-requests the chosen one', async () => {
    rewriteMock.mockResolvedValue(REWRITE_ROW)

    render(<HRConsole />)

    const select = screen.getByLabelText('Job post id')
    const options = within(select).getAllByRole('option')

    expect(options.map((option) => option.getAttribute('value'))).toEqual([
      'post-chennai-qa-analyst-118',
      'post-chennai-support-lead-207',
      'post-chennai-data-quality-311',
    ])

    await act(async () => {
      fireEvent.change(select, { target: { value: 'post-chennai-data-quality-311' } })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite this post' }))

    await waitFor(() =>
      expect(rewriteMock).toHaveBeenLastCalledWith('post-chennai-data-quality-311', {
        baseUrl: '',
        signal: expect.any(AbortSignal),
      }),
    )
  })
})
