/* The ReRoute mark: a single lightning-bolt path.
 *
 * The path is defined once here and used by the in-app logomark, with
 * `public/favicon.svg` carrying the same path for the browser tab. The source
 * SVG this came from is black artwork for a light page; on this project's
 * Obsidian canvas a black glyph is nearly invisible, so the mark inherits
 * `currentColor` and every call site sets it to the Chalk token.
 *
 * This file exports the path alongside the component so a caller can reuse the
 * exact geometry rather than re-typing it, which is why it carries the
 * react-refresh exemption.
 */

// The bolt, verbatim from the source file. The coordinates are untouched; only
// the viewBox that frames it is ours, because the source ships a box its art
// does not fill (`-5.5 0 32 32` against ink occupying x 0–20.8, y 5.0–27.0),
// which renders the mark off-centre in its own frame.
export const LOGO_PATH = 'M10.406 26.969l10.406-21.938-20.813 11.125h10.406v10.813z'

/* A square viewBox centred on the ink's true bounding box (x 0–20.81,
 * y 5.03–26.97), padded to 28 units. The centring is what makes the mark
 * legible at 16px: in the source's own box the bolt hugged the top-left with a
 * wide dead margin, which at favicon size reads as a smudge. */
export const LOGO_VIEWBOX = '-3.6 2 28 28'

/**
 * The ReRoute logomark, for the 24px icon-avatar slot inside a glossy pill.
 *
 * Decorative by construction — the button it sits in carries the label — so it
 * is hidden from assistive tech rather than given a redundant accessible name.
 * The fill is inherited rather than hard-coded so a caller can recolour the mark
 * through a text colour alone.
 *
 * @param {{
 *   size?: number,
 *   className?: string,
 * }} props
 */
export default function Logo({ size = 24, className = '' }) {
  return (
    <svg
      viewBox={LOGO_VIEWBOX}
      width={size}
      height={size}
      role="presentation"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d={LOGO_PATH} fill="currentColor" />
    </svg>
  )
}
