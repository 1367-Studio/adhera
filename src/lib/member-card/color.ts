// Colour maths for the member card. Pure and dependency-free so the React card, the settings
// screen's "your colour is too pale" hint and the PDF renderer (phase 6) all reach the same
// verdict about the same colour — a card that reads well on screen must read well printed.
//
// Everything here works on the "#RRGGBB" form that memberCardSettingsSchema already enforces
// (src/lib/member-card/settings.ts); anything else is treated as "no usable colour" rather
// than throwing, because a hand-edited Association.memberCardSettings row must never be able
// to crash a member's card.

/**
 * Used whenever `settings.color` is null — phase 1 deliberately stores null instead of a
 * default so that changing this one constant restyles every association that never picked a
 * colour. This is the app's own light-theme `--primary` (globals.css): a deep, print-safe
 * blue that carries white text, and the card surface is always light, so the light-theme
 * value is the right one even when the dashboard around it is in dark mode.
 */
export const DEFAULT_MEMBER_CARD_COLOR = "#023D9D"

/** Contrast ratio below which a colour is indistinguishable from the card's white surface. */
const TOO_LIGHT_ON_WHITE_RATIO = 1.5

const WHITE = "#ffffff"
const BLACK = "#000000"

type RgbChannels = { red: number; green: number; blue: number }

function parseHexColor(hexColor: string): RgbChannels | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hexColor.trim())
  if (!match) return null
  const hexDigits = match[1]
  return {
    red:   parseInt(hexDigits.slice(0, 2), 16),
    green: parseInt(hexDigits.slice(2, 4), 16),
    blue:  parseInt(hexDigits.slice(4, 6), 16),
  }
}

// sRGB gamma decoding, per the WCAG 2.1 definition of relative luminance.
function linearizeChannel(channelValue: number): number {
  const normalized = channelValue / 255
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

/**
 * WCAG 2.1 relative luminance, 0 (black) to 1 (white). Returns 0 for an unparseable colour:
 * black is the safest assumption, since it makes callers pick white text and treat the colour
 * as "not too light" — i.e. no false alarm and no unreadable text.
 */
export function relativeLuminance(hexColor: string): number {
  const channels = parseHexColor(hexColor)
  if (!channels) return 0
  return (
    0.2126 * linearizeChannel(channels.red) +
    0.7152 * linearizeChannel(channels.green) +
    0.0722 * linearizeChannel(channels.blue)
  )
}

/** WCAG 2.1 contrast ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrastRatio(firstHexColor: string, secondHexColor: string): number {
  const firstLuminance  = relativeLuminance(firstHexColor)
  const secondLuminance = relativeLuminance(secondHexColor)
  const lighter = Math.max(firstLuminance, secondLuminance)
  const darker  = Math.min(firstLuminance, secondLuminance)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Text drawn on top of an association's colour is pure white or pure black — whichever
 * contrasts more. No mid-tone: on a card that may be printed on a cheap office printer, the
 * two extremes are the only pair that survives.
 */
export function getContrastingTextColor(backgroundHexColor: string): typeof WHITE | typeof BLACK {
  return contrastRatio(backgroundHexColor, WHITE) >= contrastRatio(backgroundHexColor, BLACK)
    ? WHITE
    : BLACK
}

/**
 * Whether a colour would all but disappear against the card's white surface — a pale yellow
 * strip on white is invisible in print. Drives the non-blocking hint in the settings screen
 * (memberCard.settings.colorTooLight): the admin is warned, never blocked, because some
 * associations legitimately have a pale brand colour.
 */
export function isColorTooLightOnWhite(hexColor: string): boolean {
  return contrastRatio(hexColor, WHITE) < TOO_LIGHT_ON_WHITE_RATIO
}

/** The colour the card actually paints with: the association's, or the platform default. */
export function resolveMemberCardColor(settingsColor: string | null): string {
  return settingsColor ?? DEFAULT_MEMBER_CARD_COLOR
}
