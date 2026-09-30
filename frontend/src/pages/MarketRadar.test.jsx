import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MarketRadar from './MarketRadar.jsx'
import { getDisplacementRadar } from '../api.js'

vi.mock('../api.js', () => ({ getDisplacementRadar: vi.fn() }))

const RADAR_DISCLAIMER =
  'Illustrative displacement and demand figures bundled with the demo, not observed job-board data.'

const RADAR_ROW = {
  role: 'qa-analyst',
  city: 'Chennai',
  exposure: 'low',
  demand: 'growing',
  source: 'simulated',
  disclaimer: RADAR_DISCLAIMER,
}

const radarMock = vi.mocked(getDisplacementRadar)

function deferred() {
  let settle = (_value) => {}
  const promise = new Promise((resolve) => {
    settle = (value) => resolve(value)
  })

  return { promise, resolve: settle }
}

describe('MarketRadar', () => {
  beforeEach(() => {
    radarMock.mockReset()
  })

  it('loads the default radar row on mount', async () => {
    radarMock.mockResolvedValue(RADAR_ROW)

    render(<MarketRadar />)

    await waitFor(() =>
      expect(radarMock).toHaveBeenCalledWith(
        { role: 'qa-analyst', city: 'Chennai' },
        { baseUrl: '', signal: expect.any(AbortSignal) },
      ),
    )
    expect(await screen.findByTestId('radar-exposure')).toHaveTextContent('low')
    expect(screen.getByTestId('radar-demand')).toHaveTextContent('growing')
  })

  it('says the panel is sample data, never live, and shows its disclaimer', async () => {
    radarMock.mockResolvedValue(RADAR_ROW)

    const { container } = render(<MarketRadar />)

    expect(await screen.findByText(RADAR_DISCLAIMER)).toBeInTheDocument()
    expect(screen.getByText('Displacement radar:', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('simulated').closest('span.rounded-badge')).toHaveClass('border-iron')
    expect(screen.getByText('source=simulated')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\blive\b/i)
  })

  it('re-requests the radar for an edited role id', async () => {
    radarMock.mockResolvedValue(RADAR_ROW)

    render(<MarketRadar />)
    await screen.findByTestId('radar-exposure')

    fireEvent.change(screen.getByLabelText('Role id'), {
      target: { value: 'support-operations-lead' },
    })
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Bengaluru' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check exposure' }))

    await waitFor(() =>
      expect(radarMock).toHaveBeenLastCalledWith(
        { role: 'support-operations-lead', city: 'Bengaluru' },
        { baseUrl: '', signal: expect.any(AbortSignal) },
      ),
    )
  })

  it('surfaces a visible error when the radar 404s', async () => {
    radarMock.mockRejectedValue(
      new Error(
        "no simulated radar entry for role 'ghost-role' in 'Chennai'; expected one of: qa-analyst",
      ),
    )

    render(<MarketRadar />)

    const error = await screen.findByTestId('radar-error')

    expect(error).toHaveAttribute('role', 'alert')
    expect(error).toHaveTextContent('Radar unavailable')
    expect(error).toHaveTextContent('no simulated radar entry')
    expect(screen.queryByTestId('radar-exposure')).not.toBeInTheDocument()
  })

  it('shows a loading state while the request is in flight', async () => {
    const pending = deferred()
    radarMock.mockReturnValue(pending.promise)

    render(<MarketRadar />)

    expect(await screen.findByTestId('radar-loading')).toHaveTextContent('Loading radar…')
    expect(screen.getByRole('button', { name: 'Loading radar…' })).toBeDisabled()

    await act(async () => {
      pending.resolve(RADAR_ROW)
    })

    await waitFor(() => expect(screen.queryByTestId('radar-loading')).not.toBeInTheDocument())
    expect(screen.getByTestId('radar-exposure')).toHaveTextContent('low')
  })

  it('shows an empty state when the radar resolves without data', async () => {
    radarMock.mockResolvedValue(undefined)

    render(<MarketRadar />)

    expect(await screen.findByTestId('radar-empty')).toHaveTextContent('No radar row yet')
    expect(screen.queryByTestId('radar-exposure')).not.toBeInTheDocument()
  })
})
