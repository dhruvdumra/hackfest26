/* The EMI calculator with five planted bugs — the work sample from the deck.
 *
 * Kavya spent five years testing loan software, so her proof of skill is a bug
 * hunt on a loan-EMI calculator. The bugs below are deliberate, and they are
 * the same five the backend grades against (backend/app/domain/emi_bug_hunt.py):
 * a finding scores only if the inputs it reports trigger one of them there.
 * Keep the two lists in step.
 *
 *   zero-rate           0% interest divides by zero, so the EMI reads NaN
 *   years-as-months     a tenure in years is used as months
 *   negative-principal  a negative loan amount is accepted
 *   decimal-rate        8.5% is read as 8%
 *   crore-format        every amount on a loan of a crore or more loses its
 *                       last three digits
 *
 * Everything else behaves correctly, including the validation a tester would
 * expect, so an unplanted oddity does not send her chasing a false report. */

export const BUG_HUNT_SKILL_ID = 'emi-bug-hunt'
export const PLANTED_BUG_COUNT = 5

const CRORE = 10_000_000

/**
 * @typedef {{ principal: number, annualRate: number, tenure: number, tenureUnit: 'months' | 'years' }} EmiInputs
 * @typedef {{ error: string } | { error: null, emi: number, totalInterest: number, totalPayment: number, months: number }} EmiResult
 */

/**
 * The buggy calculation, exactly as the candidate sees it.
 *
 * @param {EmiInputs} inputs
 * @returns {EmiResult}
 */
export function calculateEmi({ principal, annualRate, tenure, tenureUnit }) {
  if (![principal, annualRate, tenure].every(Number.isFinite)) {
    return { error: 'Enter a number in every field.' }
  }

  if (tenure <= 0) {
    return { error: 'The tenure has to be at least one month.' }
  }

  if (annualRate < 0) {
    return { error: 'The interest rate cannot be negative.' }
  }

  // Planted: `years-as-months` — the unit is never applied.
  const months = tenureUnit === 'years' ? tenure : tenure
  // Planted: `decimal-rate` — the rate is truncated to a whole number.
  const monthlyRate = Math.trunc(annualRate) / 12 / 100
  const growth = (1 + monthlyRate) ** months
  // Planted: `zero-rate` — no special case for 0%, so this is 0 / 0.
  // Planted: `negative-principal` — the amount is never validated.
  const emi = (principal * monthlyRate * growth) / (growth - 1)
  const totalPayment = emi * months

  return {
    error: null,
    emi,
    totalInterest: totalPayment - principal,
    totalPayment,
    months,
  }
}

/**
 * Format a rupee amount the way the calculator displays it.
 *
 * @param {number} amount
 * @param {number} principal
 */
export function formatRupees(amount, principal) {
  if (Number.isNaN(amount)) {
    return '₹NaN'
  }

  if (!Number.isFinite(amount)) {
    return '₹Infinity'
  }

  // Planted: `crore-format` — on a loan of a crore or more, the display mask
  // keeps eight digits and silently drops the last three.
  const shown = principal >= CRORE ? Math.trunc(amount / 1000) : Math.round(amount)

  return `₹${shown.toLocaleString('en-IN')}`
}

/**
 * The finding the backend grades: the exact inputs plus what looked wrong.
 *
 * @param {EmiInputs} inputs
 * @param {string} note
 */
export function toFinding(inputs, note) {
  return {
    principal: inputs.principal,
    annual_rate: inputs.annualRate,
    tenure: inputs.tenure,
    tenure_unit: inputs.tenureUnit,
    note: note.trim(),
  }
}

/**
 * A recorded hunt for the presenter: four of the five bugs, found the way a
 * tester would, so the credential moment fits in the seven-minute slot. The
 * fifth is left for a judge to find live.
 */
export const RECORDED_FINDINGS = [
  toFinding(
    { principal: 500000, annualRate: 0, tenure: 60, tenureUnit: 'months' },
    'At 0% interest the EMI reads ₹NaN. It should be the principal over 60 months, ₹8,333.',
  ),
  toFinding(
    { principal: 500000, annualRate: 9, tenure: 5, tenureUnit: 'years' },
    '5 years gives the same EMI as 5 months: the tenure in years is never converted.',
  ),
  toFinding(
    { principal: -500000, annualRate: 9, tenure: 60, tenureUnit: 'months' },
    'A negative loan amount is accepted and returns a negative EMI instead of an error.',
  ),
  toFinding(
    { principal: 500000, annualRate: 8.5, tenure: 60, tenureUnit: 'months' },
    '8.5% gives exactly the EMI of 8%: the decimal part of the rate is dropped.',
  ),
]
