import {
  chalkClass,
  dataLabelClass,
  headingClass,
  manifestoClass,
  ruleClass,
  smokeClass,
} from '../styles/classes.js'
import Button from './Button.jsx'

const DEFAULT_TITLE = 'Why ReRoute?'
const DEFAULT_BODY =
  'AI proposes, a human decides on every high-stakes step. Rejections, terminations and pay are never automated.'

// The Two-Key rule, spelled out where it used to be a button pointing at
// nothing: each key is held by a person the demo has already shown.
const DEFAULT_KEYS = [
  {
    holder: 'Key 1 · Kavya',
    rule: 'Nothing about her leaves ReRoute until she says yes.',
  },
  {
    holder: 'Key 2 · The hiring manager',
    rule: 'No rewritten job post goes live until a person signs it off.',
  },
]

const DEFAULT_CTA = 'Back to the start'

const BODY_CLASS = `mx-auto mt-6 font-aeonik text-body font-normal leading-6 ${smokeClass} ${manifestoClass}`

/**
 * The page's close: the question the whole demo answers, and the rule that
 * answers it. Centred, because it is one statement rather than a panel, with
 * the two keys side by side so the rule reads as two people, not a slogan.
 *
 * @param {{
 *   title?: string,
 *   body?: string,
 *   keys?: Array<{ holder: string, rule: string }>,
 *   ctaLabel?: string,
 *   onCtaClick?: () => void,
 *   className?: string,
 * }} props
 */
export default function Manifesto({
  title = DEFAULT_TITLE,
  body = DEFAULT_BODY,
  keys = DEFAULT_KEYS,
  ctaLabel = DEFAULT_CTA,
  onCtaClick,
  className = '',
}) {
  return (
    <section
      aria-labelledby="manifesto-title"
      className={`mt-28 border-t ${ruleClass} pt-20 text-center ${className}`.trim()}
    >
      <h2 id="manifesto-title" className={`${headingClass} ${chalkClass}`}>
        {title}
      </h2>
      <p className={BODY_CLASS}>{body}</p>

      <ul className="mx-auto mt-12 grid max-w-[50rem] gap-8 text-left sm:grid-cols-2">
        {keys.map((key) => (
          <li key={key.holder} className={`border-t ${ruleClass} pt-4`}>
            <p className={dataLabelClass}>{key.holder}</p>
            <p className={`mt-2 font-aeonik text-body font-normal leading-6 ${chalkClass}`}>
              {key.rule}
            </p>
          </li>
        ))}
      </ul>

      {typeof onCtaClick === 'function' ? (
        <Button variant="ghost" arrow="↑" className="mt-12" onClick={onCtaClick}>
          {ctaLabel}
        </Button>
      ) : null}
    </section>
  )
}
