import { describe, expect, it } from 'vitest'
import { RECORDED_FINDINGS, calculateEmi, formatRupees } from './emiCalculator.js'

/** @type {import('./emiCalculator.js').EmiInputs} */
const BASE = { principal: 500000, annualRate: 9, tenure: 60, tenureUnit: 'months' }

function emi(overrides) {
  const result = calculateEmi({ ...BASE, ...overrides })

  if (result.error !== null) {
    throw new Error(result.error)
  }

  return result.emi
}

describe('the planted EMI calculator', () => {
  it('computes a correct EMI on ordinary inputs, so a clean input is not a bug', () => {
    // 5,00,000 at 9% for 60 months is ₹10,379 by the standard formula.
    expect(Math.round(emi({}))).toBe(10379)
    expect(formatRupees(emi({}), BASE.principal)).toBe('₹10,379')
  })

  it('plants zero-rate: 0% interest divides by zero', () => {
    expect(formatRupees(emi({ annualRate: 0 }), BASE.principal)).toBe('₹NaN')
  })

  it('plants years-as-months: 5 years is priced as 5 months', () => {
    expect(emi({ tenure: 5, tenureUnit: 'years' })).toBe(emi({ tenure: 5, tenureUnit: 'months' }))
  })

  it('plants negative-principal: a negative amount is accepted', () => {
    expect(emi({ principal: -500000 })).toBeLessThan(0)
  })

  it('plants decimal-rate: 8.5% is read as 8%', () => {
    expect(emi({ annualRate: 8.5 })).toBe(emi({ annualRate: 8 }))
  })

  it('plants crore-format: a crore-sized loan loses three digits on screen', () => {
    const principal = 12000000
    const shown = formatRupees(emi({ principal }), principal)

    // The real EMI is about ₹2,49,100; the display drops the last three digits.
    expect(shown).toBe('₹249')
  })

  it('validates what a correct calculator would, so testers chase planted bugs only', () => {
    expect(calculateEmi({ ...BASE, tenure: 0 }).error).toMatch(/at least one month/)
    expect(calculateEmi({ ...BASE, annualRate: -2 }).error).toMatch(/cannot be negative/)
    expect(calculateEmi({ ...BASE, principal: Number.NaN }).error).toMatch(/Enter a number/)
  })

  it('records four reproductions for the presenter and leaves one bug to find live', () => {
    expect(RECORDED_FINDINGS).toHaveLength(4)
    expect(RECORDED_FINDINGS.every((finding) => finding.note.length > 10)).toBe(true)
    expect(RECORDED_FINDINGS.some((finding) => finding.principal >= 10000000)).toBe(false)
  })
})
