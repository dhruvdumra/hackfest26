import { inlineDotClass, smokeClass } from '../styles/classes.js'

// The one bordered pill in the system, reproduced literally from the
// reference's badge block. The two literals it quotes — a surface and a border
// — are held as custom properties in tokens.css; the border reuses the Iron
// token, which is the same value.
//
// R1 hardcoded a #1a1a1a surface against a #212121 border. That is 1.19:1 — a
// badge whose edge you could not see. Both values now read the tokens, where
// the surface is a real step above the canvas and the border a real step above
// the surface.
//
// The word is set in Input 400 at 12px: this is meta, not copy, which is the one
// job the secondary face has. Line height is forced to 1 rather than the
// caption's loose 1.5 — the badge is a single line boxed in 6px of padding, and
// the reference's block says `12px/1`.
const BADGE_CLASS = [
  'inline-flex items-center gap-2 rounded-badge border border-iron',
  'bg-[var(--color-badge-surface)] px-3.5 py-1.5',
  'font-input text-[12px] font-normal uppercase leading-none tracking-badge',
].join(' ')

/* Four tones, and only four.
 *
 * R1 had two states: a Pulse Green dot for a live run, and a Graphite outline
 * for everything else. That held right up until the bias audit needed a third —
 * a FLAGGED verdict is neither "live" nor "not live", it is the finding the
 * product exists to produce, and R1 rendered it identically to a clean pass.
 * The two states differed by 0:1 of contrast, so the panel's single most
 * important output was invisible.
 *
 * The tones are the whole palette's chromatic vocabulary: the accent for live
 * and for a pass, amber for a flagged verdict, red for a failure, and an
 * untinted outline for everything that is merely not-applicable. Amber and the
 * accent sit 122° apart, which survives every form of colour-vision
 * deficiency, and no tone is ever used for decoration — each answers exactly
 * one question about state.
 *
 * Each `dot` is the COLOUR treatment only. The dot's size and shape come from
 * `inlineDotClass`, which the component applies, so a tone never restates the
 * geometry — R1's live dot carried a full class string here and composing it
 * under `inlineDotClass` emitted the size utilities twice.
 */
/** @type {Record<'accent' | 'flagged' | 'danger' | 'muted', { dot: string, ink: string }>} */
const TONES = {
  // The reference's "very subtle glow", which is the one shadow the system
  // permits outside the pill's own bevel.
  accent: { dot: 'bg-pulse-green shadow-pulse', ink: smokeClass },
  // No glow: a flagged dot is a solid amber mark, not a lamp.
  flagged: { dot: 'bg-flagged', ink: 'text-flagged' },
  danger: { dot: 'bg-danger', ink: 'text-danger' },
  // The not-applicable state: an outline, carrying no hue at all. Iron rather
  // than Graphite, because the R1 muted dot used the same border as the badge
  // itself and at 1.18:1 it was indistinguishable from the badge's own edge.
  muted: { dot: 'border border-iron bg-transparent', ink: smokeClass },
}

const DEFAULT_TONE = 'accent'

/**
 * Status / scarcity badge.
 *
 * `live` is retained from R1 and is what selects the default tone: a live run
 * gets the accent dot with the reference's "very subtle glow", and anything
 * else falls back to the muted outline. `tone` is the explicit override, and is
 * what a caller uses when the badge reports something other than liveness — the
 * bias audit's PASS and FLAGGED are the reason this prop exists.
 *
 * @param {{
 *   label?: string,
 *   live?: boolean,
 *   tone?: keyof typeof TONES,
 *   className?: string,
 * } & Record<string, unknown>} props
 */
export default function StatusBadge({
  label,
  live = true,
  tone,
  className = '',
  ...rest
}) {
  // `tone` wins over `live`, so a caller stating a specific outcome is never
  // overruled by a page-level liveness flag it happens to be carrying.
  const resolvedTone = tone ?? (live ? DEFAULT_TONE : 'muted')
  const { dot, ink } = TONES[resolvedTone] ?? TONES[DEFAULT_TONE]

  return (
    <span {...rest} className={[BADGE_CLASS, ink, className].filter(Boolean).join(' ')}>
      <span aria-hidden="true" data-status-dot="" className={`${inlineDotClass} ${dot}`} />
      {label}
    </span>
  )
}

export { StatusBadge }
