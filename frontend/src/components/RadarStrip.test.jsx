import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const radarMock = vi.fn()

vi.mock('../api.js', () => ({
  getDisplacementRadar: (query, options) => radarMock(query, options),
}))

const { default: RadarStrip } = await import('./RadarStrip.jsx')

const ROWS = {
  'manual-testing-technician': { exposure: 'high', demand: 'contracting' },
  'qa-analyst': { exposure: 'low', demand: 'growing' },
}

describe('RadarStrip', () => {
  beforeEach(() => {
    radarMock.mockReset()
    radarMock.mockImplementation(async ({ role }) => ({ role, city: 'Chennai', ...ROWS[role] }))
  })

  it('states where Kavya is and where she is going in one line', async () => {
    render(<RadarStrip />)

    expect(await screen.findByText('Exposure high · demand contracting')).toBeInTheDocument()
    expect(screen.getByText('Exposure low · demand growing')).toBeInTheDocument()
    expect(screen.getByText('Today · Manual testing technician')).toBeInTheDocument()
    expect(screen.getByText('Target · QA analyst')).toBeInTheDocument()
    expect(screen.getByText('simulated')).toBeInTheDocument()
    expect(radarMock).toHaveBeenCalledWith(
      { role: 'manual-testing-technician', city: 'Chennai' },
      expect.objectContaining({ baseUrl: '' }),
    )
  })

  it('offers a retry when the radar cannot be read', async () => {
    radarMock.mockRejectedValueOnce(new Error('The ReRoute backend is not answering.'))
    render(<RadarStrip />)

    expect(await screen.findByRole('alert')).toHaveTextContent('not answering')

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Exposure low · demand growing')).toBeInTheDocument()
  })
})
