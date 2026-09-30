import { asText } from '../lib/format.js'
import {
  bodyClass,
  captionClass,
  chalkClass,
  noteClass,
  ruleClass,
  smokeClass,
} from '../styles/classes.js'
import Card from './Card.jsx'
import StatusBadge from './StatusBadge.jsx'

/** @type {Record<string, { emptyState: boolean, titleClass: string }>} */
const STATUS_CARD_DETAILS = {
  // A quiet state recedes into Smoke; a failure is the one status here worth
  // reading at full ink. Neither gets a box, a border, or a colour of its own.
  loading: { emptyState: false, titleClass: smokeClass },
  error: { emptyState: false, titleClass: chalkClass },
  empty: { emptyState: true, titleClass: smokeClass },
}

export function DisclaimerNote({ disclaimer, scope }) {
  return (
    <p className={`mt-8 ${noteClass}`}>
      <span className="font-medium">{scope}: </span>
      {asText(disclaimer, 'Simulated demo data, not an observed ATS connection.')}
    </p>
  )
}

/**
 * One tool block inside a page section: an h3 title, one line of description
 * and the source badge. Both tools that use it (the displacement radar and the
 * job-post rewrite) serve bundled sample data, so the badge says `simulated`.
 */
export function BlockShell({ titleId, title, description, className = '', children }) {
  return (
    <Card
      as="section"
      title={title}
      titleAs="h3"
      titleId={titleId}
      description={description}
      actions={<StatusBadge label="simulated" live={false} />}
      aria-labelledby={titleId}
      padding="none"
      className={className}
    >
      {children}
    </Card>
  )
}

export function StatusMessage({ tone, title, message, testId }) {
  const details = STATUS_CARD_DETAILS[tone] ?? STATUS_CARD_DETAILS.loading

  return (
    <div
      className={`border-t ${ruleClass} ${details.emptyState ? 'px-6 py-16' : 'pt-8'}`}
      data-testid={testId}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <p className={`${captionClass} ${details.titleClass}`}>{title}</p>
      <p className={`mt-3 max-w-[40rem] text-left ${bodyClass} ${smokeClass}`}>
        {message}
      </p>
    </div>
  )
}
