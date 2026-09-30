import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Manifesto from './Manifesto.jsx'

describe('Manifesto', () => {
  it('answers its question with both keys of the Two-Key rule', () => {
    render(<Manifesto />)

    expect(screen.getByRole('heading', { name: 'Why ReRoute?' })).toBeInTheDocument()
    expect(screen.getByText('Key 1 · Kavya')).toBeInTheDocument()
    expect(screen.getByText('Key 2 · The hiring manager')).toBeInTheDocument()
  })

  it('only offers a button that does something', () => {
    const { rerender } = render(<Manifesto />)
    expect(screen.queryByRole('button')).toBeNull()

    const onCtaClick = vi.fn()
    rerender(<Manifesto onCtaClick={onCtaClick} />)
    fireEvent.click(screen.getByRole('button', { name: /Back to the start/ }))

    expect(onCtaClick).toHaveBeenCalledOnce()
  })
})
