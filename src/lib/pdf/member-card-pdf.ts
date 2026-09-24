import QRCode from "qrcode"
import {
  PDFDocument,
  StandardFonts,
  appendBezierCurve,
  clip,
  closePath,
  endPath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setFillingColor,
  setLineWidth,
  setStrokingColor,
  stroke,
  type PDFFont,
  type PDFImage,
  type PDFOperator,
  type PDFPage,
} from "pdf-lib"
import { sniffFileType } from "@/lib/file-sniff"
import { getContrastingTextColor, resolveMemberCardColor } from "@/lib/member-card/color"
import {
  CARD_ASSOCIATION_NAME_TRACKING_MM,
  CARD_CONTACT_GAP_MM,
  CARD_CONTACT_ICON_GAP_MM,
  CARD_CONTACT_ICON_SIZE_MM,
  CARD_CONTACT_MAX_WIDTH_MM,
  CARD_CONTACT_SEPARATOR_GAP_MM,
  CARD_CORNER_RADIUS_MM,
  CARD_FONT_ASSOCIATION_NAME_MM,
  CARD_FONT_BODY_MM,
  CARD_FONT_FOOTER_MM,
  CARD_FONT_INITIALS_MM,
  CARD_FONT_MEMBER_NAME_MM,
  CARD_GUTTER_MM,
  CARD_HAIRLINE_MM,
  CARD_HEADER_BAND_HEIGHT_MM,
  CARD_HEIGHT_MM,
  CARD_IDENTITY_ROW_GAP_MM,
  CARD_IDENTITY_TOP_GAP_MM,
  CARD_LOGO_MAX_HEIGHT_MM,
  CARD_LOGO_MAX_WIDTH_MM,
  CARD_LOGO_TILE_PADDING_MM,
  CARD_LOGO_TILE_RADIUS_MM,
  CARD_MARGIN_MM,
  CARD_PHOTO_DIAMETER_MM,
  CARD_QR_MIN_SIZE_MM,
  CARD_QR_SIZE_MM,
  CARD_TOP_STRIP_HEIGHT_MM,
  CARD_WIDTH_MM,
} from "@/lib/member-card/layout"
import { toSlug } from "@/lib/slug"
import type { MemberCardViewModel } from "@/lib/member-card/view-model"

// ── The printable member card ─────────────────────────────────────────────────────────────
//
// The second of the two renderers described in src/lib/member-card/layout.ts: the React card
// turns those millimetres into CSS, this one draws them at their true physical size on an A4
// sheet. Every card length below therefore comes from layout.ts — nothing here is allowed to
// invent a geometry the screen doesn't have, or the printed card and the on-screen card stop
// being the same card.
//
// Three deliberate differences from the screen card, each a consequence of paper:
//
//  1. No status line. On screen "Adhésion valide" is recomputed live on every view; printed,
//     it would outlive the membership it describes and turn a stale sheet of paper into a
//     claim the association never made. The QR is what proves validity — it resolves against
//     live eligibility — so only the date line is printed. A card printed *while already
//     expired* is the one case where that date is durable truth, and the caller labels it as
//     an expiry ("Adhésion expirée le …") rather than as a validity.
//  2. Helvetica, not the app's typeface (see sanitizeForWinAnsi below for what that costs).
//  3. A cut guide under the card: the outline to cut along, and the scale warning, because a
//     card printed with "fit to page" is no longer 85,6 mm and no longer fits a wallet.
//
// Translation happens upstream: the renderer is handed finished strings (MemberCardPdfLabels)
// and never imports next-intl, so it stays a pure function of its input and can be exercised
// from a script or a test without a request context.

const MILLIMETRES_PER_INCH = 25.4
const POINTS_PER_INCH      = 72

/**
 * The one mm → PDF-point conversion in the feature. A PDF user-space unit is 1/72 inch, so a
 * millimetre is 72/25.4 ≈ 2.834645 pt; drawing at these numbers is what makes the printed
 * card measure 85,6 mm with a ruler rather than "about card-sized".
 */
export function millimetresToPoints(lengthInMillimetres: number): number {
  return (lengthInMillimetres * POINTS_PER_INCH) / MILLIMETRES_PER_INCH
}

/** The inverse, for the two places a font metric comes back in points and has to be laid out
 *  on the card's millimetre grid (centring the initials, right-aligning the footer). */
function pointsToMillimetres(lengthInPoints: number): number {
  return (lengthInPoints * MILLIMETRES_PER_INCH) / POINTS_PER_INCH
}

// A4 portrait — the sheet, not the card, so these stay here rather than in layout.ts, which
// the React renderer also reads and which knows nothing about paper.
const PAGE_WIDTH_MM  = 210
const PAGE_HEIGHT_MM = 297
/** Distance from the top edge of the sheet to the top edge of the card. */
const CARD_TOP_MM = 30
/** Gap between the bottom of the card and the cut-guide line of text. */
const GUIDE_GAP_MM = 6
/** Side margin the guide text wraps inside — it is far wider than the card itself. */
const GUIDE_SIDE_MARGIN_MM = 20
/** Sheet furniture, not card typography: readable at arm's length on A4. */
const GUIDE_FONT_SIZE_PT = 8

/** Tailwind's `leading-tight`, which every text line on the screen card uses. */
const LINE_HEIGHT_FACTOR = 1.25
/** Tailwind's `line-clamp-2` on the member's name. */
const MEMBER_NAME_MAX_LINES = 2

// Literal colours, for the same reason the React card hard-codes its own (see the note at the
// top of member-card.tsx): a card is a printed artifact on a white surface and must not follow
// the dashboard's theme. These are the Tailwind neutrals the screen card uses.
const WHITE        = rgb(1, 1, 1)
const NEUTRAL_950  = hexToRgb("#0a0a0a") // text-neutral-950 — the card's body text
const NEUTRAL_600  = hexToRgb("#525252") // text-neutral-600 — category, validity line
const NEUTRAL_500  = hexToRgb("#737373") // text-neutral-500 — footer, cut guide
const NEUTRAL_200  = hexToRgb("#e5e5e5") // border-neutral-200 — hairlines, photo ring
const NEUTRAL_100  = hexToRgb("#f5f5f5") // bg-neutral-100 — neutral initials circle

/** Kappa: the constant that makes four cubic Béziers approximate a circle to ~0.02%. */
const BEZIER_CIRCLE_CONSTANT = 0.5522847498

/**
 * Phosphor's "Phone" glyph, regular weight, traced at build time from
 * @phosphor-icons/react/dist/defs/Phone.es.js — the same icon member-card.tsx draws with
 * <PhoneIcon>. pdf-lib has no font that carries icon glyphs, so the outline is drawn as a raw
 * SVG path instead; keeping it byte-for-byte the source package's "regular" path means the
 * printed card doesn't drift from the screen one if Phosphor ever tweaks the glyph.
 */
const PHONE_ICON_SVG_PATH =
  "M222.37,158.46l-47.11-21.11-.13-.06a16,16,0,0,0-15.17,1.4,8.12,8.12,0,0,0-.75.56L134.87,160c-15.42-7.49-31.34-23.29-38.83-38.51l20.78-24.71c.2-.25.39-.5.57-.77a16,16,0,0,0,1.32-15.06l0-.12L97.54,33.64a16,16,0,0,0-16.62-9.52A56.26,56.26,0,0,0,32,80c0,79.4,64.6,144,144,144a56.26,56.26,0,0,0,55.88-48.92A16,16,0,0,0,222.37,158.46ZM176,208A128.14,128.14,0,0,1,48,80,40.2,40.2,0,0,1,82.87,40a.61.61,0,0,0,0,.12l21,47L83.2,111.86a6.13,6.13,0,0,0-.57.77,16,16,0,0,0-1,15.7c9.06,18.53,27.73,37.06,46.46,46.11a16,16,0,0,0,15.75-1.14,8.44,8.44,0,0,0,.74-.56L168.89,152l47,21.05h0s.08,0,.11,0A40.21,40.21,0,0,1,176,208Z"
/** Phosphor icons are drawn on a 256×256 grid — the divisor that turns a target mm size into
 *  the `scale` drawSvgPath expects. */
const PHONE_ICON_VIEWBOX_SIZE = 256

export type MemberCardPdfLabels = {
  /** `memberCard.print.documentTitle`, interpolated — shown by the browser's print dialog. */
  documentTitle: string
  /**
   * The card's one date line, already interpolated: `memberCard.card.validPeriod` for a valid
   * card, `memberCard.card.expiredOn` for an expired one — which state it is belongs to the
   * caller, since the sheet prints no status line of its own (see point 1 above).
   */
  validity:      string
  /** `memberCard.card.generatedBy`, already interpolated with the app name. */
  generatedBy:   string
  /** `memberCard.print.guide` — how to print and where to cut. */
  cutGuide:      string
}

export type MemberCardPdfInput = {
  card:   MemberCardViewModel
  labels: MemberCardPdfLabels
}

// ── Text: what Helvetica can and cannot write ─────────────────────────────────────────────

// WinAnsiEncoding (CP1252) is the only encoding pdf-lib's standard fonts can write, and it
// covers Western Europe and nothing else: a Polish "Łukasz Wiśniewski", a Czech "Řehoř" or a
// Turkish "Çağrı" would make drawText *throw*, i.e. a member with a perfectly ordinary name
// would get a 500 instead of a card. So names are folded to their closest WinAnsi spelling
// rather than failing.
//
// KNOWN LIMITATION: this is a fold, not a fix. Latin scripts survive it legibly, Cyrillic,
// Greek and CJK names do not (they print as "?"), because Helvetica has no glyph for them at
// any price. The real answer is embedding a Unicode TTF with @pdf-lib/fontkit — no font ships
// offline in node_modules today (only Next's own internal Geist-Regular, with no bold weight
// and no stable path), so shipping one is a deliberate choice about repository weight and
// licensing that belongs to the owner, not to this renderer.
//
// The three ranges below are CP1252 exactly: printable ASCII, Latin-1 from NBSP up, and the
// 0x80–0x9F block Microsoft filled with typographic characters (the ’ and … the French
// catalogue is full of live in there).
const WIN_ANSI_SPECIAL_CHARACTERS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"

function isWinAnsiEncodable(character: string): boolean {
  const codePoint = character.codePointAt(0) ?? 0
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true
  return WIN_ANSI_SPECIAL_CHARACTERS.includes(character)
}

// Latin letters that carry no decomposable accent, so stripping combining marks leaves them
// untouched — without this row a Polish "Łukasz" would print as "ukasz".
const WIN_ANSI_LETTER_FALLBACKS: Record<string, string> = {
  "Ł": "L", "ł": "l",
  "Đ": "D", "đ": "d",
  "Ħ": "H", "ħ": "h",
  "İ": "I", "ı": "i",
  "Ŋ": "N", "ŋ": "n",
  "Ŧ": "T", "ŧ": "t",
  "Ə": "E", "ə": "e",
}

/**
 * Folds a string to something Helvetica can actually draw, in three steps per character:
 * keep it if WinAnsi has it, else strip its combining accents (ś → s, ř → r, ğ → g), else use
 * an explicit fallback letter. Anything left — a Cyrillic, Greek or CJK name, for which
 * Helvetica has no glyph at any price — becomes "?", which is visibly wrong rather than
 * silently missing, and above all is not an exception thrown at a member holding a valid
 * membership.
 */
export function sanitizeForWinAnsi(text: string): string {
  let sanitized = ""
  for (const character of text) {
    if (isWinAnsiEncodable(character)) { sanitized += character; continue }

    // NFD splits "ś" into "s" + a combining acute accent; dropping the marks leaves the base
    // letter, which WinAnsi almost always has.
    const withoutCombiningMarks = character.normalize("NFD").replace(/\p{M}/gu, "")
    if (withoutCombiningMarks && [...withoutCombiningMarks].every(isWinAnsiEncodable)) {
      sanitized += withoutCombiningMarks
      continue
    }

    sanitized += WIN_ANSI_LETTER_FALLBACKS[character] ?? "?"
  }
  return sanitized
}

/**
 * Name of the downloaded file: `carte-membre-martin-camille.pdf`, last name first like every
 * other member export, and pure ASCII so it survives a Content-Disposition header unescaped.
 *
 * Folded through sanitizeForWinAnsi before toSlug (the association/event slug helper) for the
 * letters toSlug alone cannot handle: it strips combining accents, so "Wiśniewski" already
 * becomes "wisniewski", but "Łukasz" — whose Ł carries no separable accent — would lose its
 * first letter entirely and slug to "ukasz". Falls back to the bare prefix for a name that
 * folds to nothing at all (a Cyrillic or CJK one), since a browser must never be handed
 * `carte-membre--.pdf`.
 */
export function memberCardPdfFilename(lastName: string, firstName: string): string {
  const nameParts = [lastName, firstName]
    .map(namePart => toSlug(sanitizeForWinAnsi(namePart)))
    .filter(namePart => namePart.length > 0)
  return ["carte-membre", ...nameParts].join("-") + ".pdf"
}

// ── Images: what the server is allowed to fetch ───────────────────────────────────────────

/**
 * SECURITY — this renderer runs server-side and fetch()es the URLs it is given, so an
 * unchecked URL is a straight SSRF primitive: the member photo is writable by the member
 * themselves (PATCH /api/portal/profil takes `photoUrl` as a free-form string), and pointing
 * it at an internal address would make our own server fetch it and hand the bytes back inside
 * a PDF. Only our R2 public host is accepted, compared on the full origin exactly like
 * isAllowedLogoUrl in src/app/api/association/branding/route.ts — a prefix test would let
 * "https://<bucket>.r2.dev.evil.com" through. Anything else is skipped, never fetched.
 */
export function isMemberCardImageUrlAllowed(imageUrl: string): boolean {
  const allowedBase = process.env.R2_PUBLIC_URL
  if (!allowedBase) return false
  try {
    return new URL(imageUrl).origin === new URL(allowedBase).origin
  } catch {
    return false
  }
}

/** Well past what any printer resolves, and small enough that a 4 MB upload doesn't become a
 *  4 MB sheet: the card's photo is drawn 16 mm wide, i.e. ~378 px at this density. */
const PRINT_RESOLUTION_DPI = 600
/** Seconds our own R2 gets before the image is given up on — a hung fetch would otherwise
 *  burn the whole function timeout for a decoration. */
const IMAGE_FETCH_TIMEOUT_MS = 8_000

type PrintableImage = { bytes: Buffer; isPng: boolean }

/**
 * Downscales to the resolution the card actually prints at and re-encodes into one of the two
 * formats pdf-lib can embed — which is also the conversion our WebP and GIF uploads need (see
 * sniffFileType): those used to disappear from generated PDFs without a word.
 *
 * PNG when the image is transparent (a logo, almost always), JPEG otherwise: a photograph
 * re-encoded as PNG is several times its own weight, and the member's photo is the heaviest
 * thing on an otherwise 6 KB sheet.
 *
 * sharp is imported lazily so a deployment whose native binary is unavailable loses the
 * *image* rather than the whole route (the caller then falls back to embedding PNG/JPEG
 * as-is), and so the pure helpers above stay testable without loading a native module.
 */
async function toPrintableImage(originalBytes: Buffer, maxDrawnSizeMillimetres: number): Promise<PrintableImage | null> {
  try {
    const { default: sharp } = await import("sharp")
    const { hasAlpha } = await sharp(originalBytes).metadata()

    const maxPixels = Math.ceil((maxDrawnSizeMillimetres / MILLIMETRES_PER_INCH) * PRINT_RESOLUTION_DPI)
    const resized = sharp(originalBytes)
      .resize({ width: maxPixels, height: maxPixels, fit: "inside", withoutEnlargement: true })

    return hasAlpha
      ? { bytes: await resized.png({ compressionLevel: 9 }).toBuffer(), isPng: true }
      : { bytes: await resized.jpeg({ quality: 85 }).toBuffer(),        isPng: false }
  } catch {
    return null
  }
}

/**
 * Fetches one of our own stored images and embeds it, at the size the card draws it.
 *
 * Returns null on every failure: a logo that won't load means a card with no logo, a photo
 * that won't load means initials. Neither is worth failing a download over.
 */
async function embedRemoteImage(
  pdfDocument: PDFDocument,
  imageUrl: string,
  maxDrawnSizeMillimetres: number,
): Promise<PDFImage | null> {
  if (!isMemberCardImageUrlAllowed(imageUrl)) return null

  try {
    // `redirect: "manual"`, so the origin allowlist above covers the whole fetch and not just
    // its first hop: followed automatically, a 302 served from our own bucket would pull the
    // bytes from wherever it points, which is exactly what the allowlist exists to prevent.
    // A redirect then arrives as a non-ok response and the image is skipped like any other
    // failure — our own R2 objects are served directly and never redirect.
    const response = await fetch(imageUrl, {
      signal:   AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
      redirect: "manual",
    })
    if (!response.ok) return null
    const originalBytes = Buffer.from(await response.arrayBuffer())

    // Sniffed from the magic bytes rather than trusted from Content-Type, like every other
    // place the app decides what a stored file really is. A PDF stored in the same bucket is
    // a legitimate upload and simply isn't an image we can draw.
    const fileType = sniffFileType(originalBytes)
    if (fileType === null || fileType === "application/pdf") return null

    const printable = await toPrintableImage(originalBytes, maxDrawnSizeMillimetres)
    if (printable) {
      return printable.isPng
        ? await pdfDocument.embedPng(printable.bytes)
        : await pdfDocument.embedJpg(printable.bytes)
    }

    // sharp unavailable: PNG and JPEG still embed as-is, at their original weight. WebP and
    // GIF have no path left, so the card falls back to no logo / initials.
    if (fileType === "image/png")  return await pdfDocument.embedPng(originalBytes)
    if (fileType === "image/jpeg") return await pdfDocument.embedJpg(originalBytes)
    return null
  } catch {
    return null
  }
}

// ── Path helpers ──────────────────────────────────────────────────────────────────────────
//
// pdf-lib has no rounded rectangle and no circle, and no clipping helper either, so both
// shapes are traced by hand as cubic Béziers and then used as fill, stroke or clipping paths.
// Square corners were the alternative; they were rejected because the 3,18 mm ISO corner is
// the single detail that makes a printed rectangle read as a card, and because the coloured
// strip and band have to be clipped to the card's silhouette anyway.

function roundedRectanglePath(leftPt: number, bottomPt: number, widthPt: number, heightPt: number, radiusPt: number): PDFOperator[] {
  const rightPt  = leftPt + widthPt
  const topPt    = bottomPt + heightPt
  const controlPt = radiusPt * BEZIER_CIRCLE_CONSTANT

  return [
    moveTo(leftPt + radiusPt, bottomPt),
    lineTo(rightPt - radiusPt, bottomPt),
    appendBezierCurve(rightPt - radiusPt + controlPt, bottomPt, rightPt, bottomPt + radiusPt - controlPt, rightPt, bottomPt + radiusPt),
    lineTo(rightPt, topPt - radiusPt),
    appendBezierCurve(rightPt, topPt - radiusPt + controlPt, rightPt - radiusPt + controlPt, topPt, rightPt - radiusPt, topPt),
    lineTo(leftPt + radiusPt, topPt),
    appendBezierCurve(leftPt + radiusPt - controlPt, topPt, leftPt, topPt - radiusPt + controlPt, leftPt, topPt - radiusPt),
    lineTo(leftPt, bottomPt + radiusPt),
    appendBezierCurve(leftPt, bottomPt + radiusPt - controlPt, leftPt + radiusPt - controlPt, bottomPt, leftPt + radiusPt, bottomPt),
    closePath(),
  ]
}

function circlePath(centreXPt: number, centreYPt: number, radiusPt: number): PDFOperator[] {
  const controlPt = radiusPt * BEZIER_CIRCLE_CONSTANT

  return [
    moveTo(centreXPt + radiusPt, centreYPt),
    appendBezierCurve(centreXPt + radiusPt, centreYPt + controlPt, centreXPt + controlPt, centreYPt + radiusPt, centreXPt, centreYPt + radiusPt),
    appendBezierCurve(centreXPt - controlPt, centreYPt + radiusPt, centreXPt - radiusPt, centreYPt + controlPt, centreXPt - radiusPt, centreYPt),
    appendBezierCurve(centreXPt - radiusPt, centreYPt - controlPt, centreXPt - controlPt, centreYPt - radiusPt, centreXPt, centreYPt - radiusPt),
    appendBezierCurve(centreXPt + controlPt, centreYPt - radiusPt, centreXPt + radiusPt, centreYPt - controlPt, centreXPt + radiusPt, centreYPt),
    closePath(),
  ]
}

function hexToRgb(hexColor: string) {
  const red   = parseInt(hexColor.slice(1, 3), 16) / 255
  const green = parseInt(hexColor.slice(3, 5), 16) / 255
  const blue  = parseInt(hexColor.slice(5, 7), 16) / 255
  return rgb(red, green, blue)
}

// ── Text measuring and fitting ────────────────────────────────────────────────────────────

/** Width of a drawn string, letter-spacing included — widthOfTextAtSize ignores it. */
function measureTextWidth(font: PDFFont, text: string, sizePt: number, characterSpacingPt: number): number {
  const spacingWidth = text.length > 0 ? characterSpacingPt * (text.length - 1) : 0
  return font.widthOfTextAtSize(text, sizePt) + spacingWidth
}

/**
 * CSS `truncate`: the longest prefix that fits, with an ellipsis (WinAnsi 0x85) if cut.
 *
 * Exported for the tests, like the other pure helpers in this module: it is what caps the
 * association's contact line at CARD_CONTACT_MAX_WIDTH_MM, and "how many characters fit" is a
 * measured answer that no character count could stand in for.
 */
export function truncateToWidth(font: PDFFont, text: string, sizePt: number, maxWidthPt: number, characterSpacingPt = 0): string {
  if (measureTextWidth(font, text, sizePt, characterSpacingPt) <= maxWidthPt) return text

  let kept = ""
  for (const character of text) {
    const candidate = `${kept}${character}…`
    if (measureTextWidth(font, candidate, sizePt, characterSpacingPt) > maxWidthPt) break
    kept += character
  }
  return kept.length > 0 ? `${kept}…` : ""
}

/** CSS `line-clamp`: word wrapping capped at maxLines, the last one ellipsised if text is left. */
function wrapToWidth(font: PDFFont, text: string, sizePt: number, maxWidthPt: number, maxLines: number): string[] {
  const lines: string[] = []
  let currentLine = ""

  for (const word of text.split(/\s+/).filter(part => part.length > 0)) {
    const candidate = currentLine ? `${currentLine} ${word}` : word
    // `!currentLine` keeps a single word wider than the column on its own line rather than
    // looping forever; truncateToWidth below cuts it.
    if (!currentLine || font.widthOfTextAtSize(candidate, sizePt) <= maxWidthPt) {
      currentLine = candidate
      continue
    }
    lines.push(currentLine)
    currentLine = word
  }
  if (currentLine) lines.push(currentLine)

  const keptLines = lines.slice(0, maxLines)
  const lastIndex = keptLines.length - 1
  if (lastIndex >= 0) {
    // The clamped line gets the ellipsis only when something was actually dropped; every line
    // is run through truncateToWidth anyway, for the over-long single word above.
    const clampedText = lines.length > maxLines ? `${keptLines[lastIndex]}…` : keptLines[lastIndex]
    keptLines[lastIndex] = truncateToWidth(font, clampedText, sizePt, maxWidthPt)
  }
  return keptLines.map((line, lineIndex) =>
    lineIndex === lastIndex ? line : truncateToWidth(font, line, sizePt, maxWidthPt))
}

/**
 * Where a line's baseline sits below the top of its line box, so a PDF line stacks exactly
 * like the corresponding CSS one: half the leading, then the ascender.
 */
function baselineOffsetMillimetres(font: PDFFont, sizeMillimetres: number): number {
  const ascenderHeight = font.heightAtSize(sizeMillimetres, { descender: false })
  const fullHeight     = font.heightAtSize(sizeMillimetres)
  return (LINE_HEIGHT_FACTOR * sizeMillimetres - fullHeight) / 2 + ascenderHeight
}

// ── The renderer ──────────────────────────────────────────────────────────────────────────

/**
 * One A4 portrait page carrying a single card at its true physical size, plus the cut guide.
 * Callers hand it a view model built by buildMemberCardViewModel — i.e. a member whose card
 * is printable — and finished label strings.
 */
export async function buildMemberCardPdf({ card, labels }: MemberCardPdfInput): Promise<Buffer> {
  const pdfDocument = await PDFDocument.create()
  // showInWindowTitleBar is what makes the browser's own PDF viewer (and so the print dialog
  // it opens) show "Carte de membre — Camille Martin" instead of the file name.
  pdfDocument.setTitle(labels.documentTitle, { showInWindowTitleBar: true })

  const regularFont  = await pdfDocument.embedFont(StandardFonts.Helvetica)
  const semiboldFont = await pdfDocument.embedFont(StandardFonts.HelveticaBold)

  const page = pdfDocument.addPage([millimetresToPoints(PAGE_WIDTH_MM), millimetresToPoints(PAGE_HEIGHT_MM)])

  const { settings } = card
  const accentColor  = resolveMemberCardColor(settings.color)
  const isModern     = settings.template === "modern"
  const isMinimal    = settings.template === "minimal"

  // Card-local coordinates: millimetres from the card's top-left corner, the way layout.ts and
  // the React card both think, converted to PDF's bottom-left points only at draw time.
  const cardLeftMm = (PAGE_WIDTH_MM - CARD_WIDTH_MM) / 2
  const cardLeftPt = millimetresToPoints(cardLeftMm)
  const cardTopPt  = millimetresToPoints(PAGE_HEIGHT_MM - CARD_TOP_MM)
  const cardX = (offsetMillimetres: number) => cardLeftPt + millimetresToPoints(offsetMillimetres)
  const cardY = (offsetFromTopMillimetres: number) => cardTopPt - millimetresToPoints(offsetFromTopMillimetres)

  const cardPath = () => roundedRectanglePath(
    cardX(0),
    cardY(CARD_HEIGHT_MM),
    millimetresToPoints(CARD_WIDTH_MM),
    millimetresToPoints(CARD_HEIGHT_MM),
    millimetresToPoints(CARD_CORNER_RADIUS_MM),
  )

  function drawTextLine(options: {
    text:               string
    font:               PDFFont
    sizeMillimetres:    number
    leftMillimetres:    number
    topMillimetres:     number
    color:              ReturnType<typeof rgb>
    trackingMillimetres?: number
  }) {
    const sizePt      = millimetresToPoints(options.sizeMillimetres)
    const trackingPt  = millimetresToPoints(options.trackingMillimetres ?? 0)
    const baselineMm  = options.topMillimetres + baselineOffsetMillimetres(options.font, options.sizeMillimetres)

    if (trackingPt) page.pushOperators(pushGraphicsState(), setCharacterSpacing(trackingPt))
    page.drawText(options.text, {
      x:     cardX(options.leftMillimetres),
      y:     cardY(baselineMm),
      size:  sizePt,
      font:  options.font,
      color: options.color,
    })
    if (trackingPt) page.pushOperators(popGraphicsState())
  }

  // ── Card surface ────────────────────────────────────────────────────────────────────────
  drawFilledPath(page, cardPath(), WHITE)

  // Full-bleed colour: the thin top strip (classic) or the whole header band (modern), clipped
  // to the card's rounded silhouette the way `overflow-hidden` clips it on screen.
  if (!isMinimal) {
    const colorLayerHeightMm = isModern ? CARD_HEADER_BAND_HEIGHT_MM : CARD_TOP_STRIP_HEIGHT_MM
    page.pushOperators(pushGraphicsState(), ...cardPath(), clip(), endPath())
    page.drawRectangle({
      x:      cardX(0),
      y:      cardY(colorLayerHeightMm),
      width:  millimetresToPoints(CARD_WIDTH_MM),
      height: millimetresToPoints(colorLayerHeightMm),
      color:  hexToRgb(accentColor),
    })
    page.pushOperators(popGraphicsState())
  }

  // ── Header: logo + association name ─────────────────────────────────────────────────────
  const logoImage = card.logoUrl
    ? await embedRemoteImage(pdfDocument, card.logoUrl, CARD_LOGO_MAX_WIDTH_MM)
    : null
  let associationNameLeftMm = CARD_MARGIN_MM

  if (logoImage) {
    // object-contain inside the layout's logo box, then centred in the header band.
    const fitScale  = Math.min(
      CARD_LOGO_MAX_WIDTH_MM / logoImage.width,
      CARD_LOGO_MAX_HEIGHT_MM / logoImage.height,
    )
    const logoWidthMm  = logoImage.width * fitScale
    const logoHeightMm = logoImage.height * fitScale

    // `modern` only: a white tile under the logo, so a dark logo survives the coloured band.
    // It hugs the fitted logo horizontally and keeps the box's full height, like the CSS one.
    const tilePaddingMm = isModern ? CARD_LOGO_TILE_PADDING_MM : 0
    const tileWidthMm   = logoWidthMm + 2 * tilePaddingMm
    const tileHeightMm  = (isModern ? CARD_LOGO_MAX_HEIGHT_MM : logoHeightMm) + 2 * tilePaddingMm
    const tileTopMm     = (CARD_HEADER_BAND_HEIGHT_MM - tileHeightMm) / 2

    if (isModern) {
      drawFilledPath(page, roundedRectanglePath(
        cardX(CARD_MARGIN_MM),
        cardY(tileTopMm + tileHeightMm),
        millimetresToPoints(tileWidthMm),
        millimetresToPoints(tileHeightMm),
        millimetresToPoints(CARD_LOGO_TILE_RADIUS_MM),
      ), WHITE)
    }

    page.drawImage(logoImage, {
      x:      cardX(CARD_MARGIN_MM + tilePaddingMm),
      y:      cardY((CARD_HEADER_BAND_HEIGHT_MM + logoHeightMm) / 2),
      width:  millimetresToPoints(logoWidthMm),
      height: millimetresToPoints(logoHeightMm),
    })

    associationNameLeftMm = CARD_MARGIN_MM + tileWidthMm + CARD_GUTTER_MM
  }

  const associationNameMaxWidthPt = millimetresToPoints(CARD_WIDTH_MM - CARD_MARGIN_MM - associationNameLeftMm)
  const associationNameText = truncateToWidth(
    semiboldFont,
    sanitizeForWinAnsi(card.associationName).toUpperCase(),
    millimetresToPoints(CARD_FONT_ASSOCIATION_NAME_MM),
    associationNameMaxWidthPt,
    millimetresToPoints(CARD_ASSOCIATION_NAME_TRACKING_MM),
  )
  drawTextLine({
    text:            associationNameText,
    font:            semiboldFont,
    sizeMillimetres: CARD_FONT_ASSOCIATION_NAME_MM,
    leftMillimetres: associationNameLeftMm,
    // Centred in the band, like the flex row on screen.
    topMillimetres:  (CARD_HEADER_BAND_HEIGHT_MM - LINE_HEIGHT_FACTOR * CARD_FONT_ASSOCIATION_NAME_MM) / 2,
    // `modern` paints the band, so its text has to fight the association's colour.
    color:            isModern ? hexToRgb(getContrastingTextColor(accentColor)) : NEUTRAL_950,
    trackingMillimetres: CARD_ASSOCIATION_NAME_TRACKING_MM,
  })

  // Hairline under the header — `modern` separates by colour instead and needs none.
  if (!isModern) {
    page.drawLine({
      start:     { x: cardX(CARD_MARGIN_MM), y: cardY(CARD_HEADER_BAND_HEIGHT_MM) },
      end:       { x: cardX(CARD_WIDTH_MM - CARD_MARGIN_MM), y: cardY(CARD_HEADER_BAND_HEIGHT_MM) },
      thickness: millimetresToPoints(CARD_HAIRLINE_MM),
      color:     NEUTRAL_200,
    })
  }

  // ── Identity row: photo · name + category · QR ──────────────────────────────────────────
  const identityTopMm = CARD_HEADER_BAND_HEIGHT_MM + CARD_IDENTITY_TOP_GAP_MM
  let identityTextLeftMm = CARD_MARGIN_MM

  if (settings.showPhoto) {
    const photoRadiusMm  = CARD_PHOTO_DIAMETER_MM / 2
    const photoCentreXPt = cardX(CARD_MARGIN_MM + photoRadiusMm)
    const photoCentreYPt = cardY(identityTopMm + photoRadiusMm)
    const photoPath = () => circlePath(photoCentreXPt, photoCentreYPt, millimetresToPoints(photoRadiusMm))

    const photoImage = card.photoUrl
      ? await embedRemoteImage(pdfDocument, card.photoUrl, CARD_PHOTO_DIAMETER_MM)
      : null

    if (photoImage) {
      // object-cover: fill the circle on its smaller side and let the other overflow, clipped.
      const coverScale   = Math.max(
        CARD_PHOTO_DIAMETER_MM / photoImage.width,
        CARD_PHOTO_DIAMETER_MM / photoImage.height,
      )
      const drawnWidthMm  = photoImage.width * coverScale
      const drawnHeightMm = photoImage.height * coverScale

      page.pushOperators(pushGraphicsState(), ...photoPath(), clip(), endPath())
      page.drawImage(photoImage, {
        x:      photoCentreXPt - millimetresToPoints(drawnWidthMm / 2),
        y:      photoCentreYPt - millimetresToPoints(drawnHeightMm / 2),
        width:  millimetresToPoints(drawnWidthMm),
        height: millimetresToPoints(drawnHeightMm),
      })
      page.pushOperators(popGraphicsState())
    } else {
      // Initials stand in for a missing photo; only `classic` tints them with the
      // association's colour, the other two keep them neutral — same rule as the screen card.
      const usesAccentInitials = settings.template === "classic"
      drawFilledPath(page, photoPath(), usesAccentInitials ? hexToRgb(accentColor) : NEUTRAL_100)

      const initialsText    = sanitizeForWinAnsi(card.initials)
      const initialsWidthMm = pointsToMillimetres(
        semiboldFont.widthOfTextAtSize(initialsText, millimetresToPoints(CARD_FONT_INITIALS_MM)),
      )
      drawTextLine({
        text:            initialsText,
        font:            semiboldFont,
        sizeMillimetres: CARD_FONT_INITIALS_MM,
        leftMillimetres: CARD_MARGIN_MM + photoRadiusMm - initialsWidthMm / 2,
        topMillimetres:  identityTopMm + photoRadiusMm - (LINE_HEIGHT_FACTOR * CARD_FONT_INITIALS_MM) / 2,
        color:           usesAccentInitials ? hexToRgb(getContrastingTextColor(accentColor)) : NEUTRAL_600,
      })
    }

    drawStrokedPath(page, photoPath(), NEUTRAL_200, millimetresToPoints(CARD_HAIRLINE_MM))
    identityTextLeftMm = CARD_MARGIN_MM + CARD_PHOTO_DIAMETER_MM + CARD_GUTTER_MM
  }

  // Never below CARD_QR_MIN_SIZE_MM: a printed QR smaller than that stops resolving reliably,
  // and no template is allowed to shrink it past the minimum (see layout.ts).
  const qrSizeMm = Math.max(CARD_QR_SIZE_MM, CARD_QR_MIN_SIZE_MM)
  const qrLeftMm = CARD_WIDTH_MM - CARD_MARGIN_MM - qrSizeMm
  // margin: 0 like the screen card's own QR — the quiet zone is the card's white surface
  // itself, which leaves CARD_MARGIN_MM (4 mm) to its right and CARD_GUTTER_MM (3 mm) to its
  // left, both well past the 4 modules the spec asks for at this module size. Baking a margin
  // into the image instead would shrink the code below CARD_QR_MIN_SIZE_MM at the same
  // footprint. Rendered at 4× the printed resolution so the modules stay crisp on paper.
  const qrPngBytes = await QRCode.toBuffer(card.verificationUrl, {
    type:                 "png",
    width:                Math.round(millimetresToPoints(qrSizeMm) * 4),
    margin:               0,
    errorCorrectionLevel: "M",
  })
  const qrImage = await pdfDocument.embedPng(qrPngBytes)
  page.drawImage(qrImage, {
    x:      cardX(qrLeftMm),
    y:      cardY(identityTopMm + qrSizeMm),
    width:  millimetresToPoints(qrSizeMm),
    height: millimetresToPoints(qrSizeMm),
  })

  const identityTextWidthPt = millimetresToPoints(qrLeftMm - CARD_GUTTER_MM - identityTextLeftMm)
  const memberNameLines = wrapToWidth(
    semiboldFont,
    sanitizeForWinAnsi(card.memberName),
    millimetresToPoints(CARD_FONT_MEMBER_NAME_MM),
    identityTextWidthPt,
    MEMBER_NAME_MAX_LINES,
  )
  memberNameLines.forEach((line, lineIndex) => {
    drawTextLine({
      text:            line,
      font:            semiboldFont,
      sizeMillimetres: CARD_FONT_MEMBER_NAME_MM,
      leftMillimetres: identityTextLeftMm,
      topMillimetres:  identityTopMm + lineIndex * LINE_HEIGHT_FACTOR * CARD_FONT_MEMBER_NAME_MM,
      color:           NEUTRAL_950,
    })
  })

  // Category and tarifa stack below the name, each row's top computed from where the previous
  // one ended — each behind its own setting, never gated together: a tarifa is not a
  // MembreType (see MembershipTier.membreTypeId).
  let nextIdentityRowTopMm = identityTopMm + memberNameLines.length * LINE_HEIGHT_FACTOR * CARD_FONT_MEMBER_NAME_MM

  if (settings.showCategory && card.category) {
    const categoryTopMm = nextIdentityRowTopMm + CARD_IDENTITY_ROW_GAP_MM
    drawTextLine({
      text: truncateToWidth(
        regularFont,
        sanitizeForWinAnsi(card.category),
        millimetresToPoints(CARD_FONT_BODY_MM),
        identityTextWidthPt,
      ),
      font:            regularFont,
      sizeMillimetres: CARD_FONT_BODY_MM,
      leftMillimetres: identityTextLeftMm,
      topMillimetres:  categoryTopMm,
      color:           NEUTRAL_600,
    })
    nextIdentityRowTopMm = categoryTopMm + LINE_HEIGHT_FACTOR * CARD_FONT_BODY_MM
  }

  if (settings.showTier && card.tier) {
    const tierTopMm = nextIdentityRowTopMm + CARD_IDENTITY_ROW_GAP_MM
    drawTextLine({
      text: truncateToWidth(
        regularFont,
        sanitizeForWinAnsi(card.tier),
        millimetresToPoints(CARD_FONT_BODY_MM),
        identityTextWidthPt,
      ),
      font:            regularFont,
      sizeMillimetres: CARD_FONT_BODY_MM,
      leftMillimetres: identityTextLeftMm,
      topMillimetres:  tierTopMm,
      color:           NEUTRAL_600,
    })
  }

  // ── Bottom block: association contact · validity · "généré via Formwise" ────────────────
  // Bottom-aligned on the card's baseline, like `items-end` on screen, so it stays put
  // whatever the identity row above it contains. No status line — see the module note.
  const contentBottomMm = CARD_HEIGHT_MM - CARD_MARGIN_MM
  const validityTopMm   = contentBottomMm - LINE_HEIGHT_FACTOR * CARD_FONT_BODY_MM

  // Measured, not assumed to fit: pdf-response.ts already drops the year from a same-season
  // "from" date to keep this line short, but a multi-year custom-duration tier (or a locale
  // whose wording simply runs long) can still be wider than the row has room for once
  // "généré via {appName}" claims its own share on the right — truncateToWidth is the same
  // safety net the contact line below already relies on, so the two texts can never overlap.
  const generatedByText    = sanitizeForWinAnsi(labels.generatedBy)
  const generatedByWidthMm = pointsToMillimetres(
    regularFont.widthOfTextAtSize(generatedByText, millimetresToPoints(CARD_FONT_FOOTER_MM)),
  )
  const validityMaxWidthMm = CARD_WIDTH_MM - 2 * CARD_MARGIN_MM - CARD_GUTTER_MM - generatedByWidthMm

  drawTextLine({
    text: truncateToWidth(
      regularFont,
      sanitizeForWinAnsi(labels.validity),
      millimetresToPoints(CARD_FONT_BODY_MM),
      millimetresToPoints(Math.max(0, validityMaxWidthMm)),
    ),
    font:            regularFont,
    sizeMillimetres: CARD_FONT_BODY_MM,
    leftMillimetres: CARD_MARGIN_MM,
    topMillimetres:  validityTopMm,
    color:           NEUTRAL_600,
  })

  // The association's phone / e-mail, one gap above the validity line — the same place and
  // the same tone as on the screen card, phone icon included (PHONE_ICON_SVG_PATH is Phosphor's
  // own outline, so it's the same glyph the screen card's <PhoneIcon> draws — see
  // member-card.tsx). Drawn as up to four separate runs (icon, phone, a middle dot with extra
  // breathing room on each side, e-mail) rather than one joined string, so the two values read
  // as distinct fields instead of a single run-on line. Positions are measured, not
  // counted in characters: the phone is capped at the full CARD_CONTACT_MAX_WIDTH_MM (it is
  // always short in practice — the settings form caps it at 30 characters — but a renderer
  // must not depend on a limit enforced two layers away), and the e-mail eats whatever the
  // phone and separator left of that budget, with truncateToWidth ellipsising it there so it
  // stops one gutter short of the QR instead of reaching it. The middle dot is WinAnsi 0xB7
  // and survives sanitizeForWinAnsi.
  if (card.contactPhone || card.contactEmail) {
    const contactTopMm  = validityTopMm - CARD_CONTACT_GAP_MM - LINE_HEIGHT_FACTOR * CARD_FONT_FOOTER_MM
    const footerSizePt  = millimetresToPoints(CARD_FONT_FOOTER_MM)
    let cursorMm        = CARD_MARGIN_MM

    if (card.contactPhone) {
      // Vertically centred in the line box, like `items-center` does for the screen card's
      // <PhoneIcon> — the icon's own height (CARD_CONTACT_ICON_SIZE_MM) is shorter than the
      // line box (LINE_HEIGHT_FACTOR × the footer font), so it sits with equal breathing room
      // above and below rather than pinned to the text baseline.
      const iconTopMm = contactTopMm + (LINE_HEIGHT_FACTOR * CARD_FONT_FOOTER_MM - CARD_CONTACT_ICON_SIZE_MM) / 2
      page.drawSvgPath(PHONE_ICON_SVG_PATH, {
        x:     cardX(cursorMm),
        y:     cardY(iconTopMm),
        scale: millimetresToPoints(CARD_CONTACT_ICON_SIZE_MM) / PHONE_ICON_VIEWBOX_SIZE,
        color: NEUTRAL_500,
      })
      cursorMm += CARD_CONTACT_ICON_SIZE_MM + CARD_CONTACT_ICON_GAP_MM

      // Reduced by the icon's own footprint: CARD_CONTACT_MAX_WIDTH_MM is the budget for the
      // whole row (icon + phone + separator + e-mail, same box the screen card's maxWidth
      // uses), and the phone now starts CARD_CONTACT_ICON_SIZE_MM + CARD_CONTACT_ICON_GAP_MM
      // to the right of that row's left edge — without subtracting it here, an unusually long
      // phone number could truncate to a width that runs past the QR column. Still keeps this
      // renderer independent of the settings form's 30-character cap, per the note above.
      const phoneText = truncateToWidth(
        regularFont,
        sanitizeForWinAnsi(card.contactPhone),
        footerSizePt,
        millimetresToPoints(CARD_CONTACT_MAX_WIDTH_MM - CARD_CONTACT_ICON_SIZE_MM - CARD_CONTACT_ICON_GAP_MM),
      )
      drawTextLine({
        text: phoneText, font: regularFont, sizeMillimetres: CARD_FONT_FOOTER_MM,
        leftMillimetres: cursorMm, topMillimetres: contactTopMm, color: NEUTRAL_500,
      })
      cursorMm += pointsToMillimetres(regularFont.widthOfTextAtSize(phoneText, footerSizePt))
    }

    if (card.contactPhone && card.contactEmail) {
      cursorMm += CARD_CONTACT_SEPARATOR_GAP_MM
      drawTextLine({
        text: "·", font: regularFont, sizeMillimetres: CARD_FONT_FOOTER_MM,
        leftMillimetres: cursorMm, topMillimetres: contactTopMm, color: NEUTRAL_500,
      })
      cursorMm += pointsToMillimetres(regularFont.widthOfTextAtSize("·", footerSizePt)) + CARD_CONTACT_SEPARATOR_GAP_MM
    }

    if (card.contactEmail) {
      const remainingWidthPt = Math.max(0, millimetresToPoints(CARD_CONTACT_MAX_WIDTH_MM - (cursorMm - CARD_MARGIN_MM)))
      drawTextLine({
        text: truncateToWidth(regularFont, sanitizeForWinAnsi(card.contactEmail), footerSizePt, remainingWidthPt),
        font: regularFont, sizeMillimetres: CARD_FONT_FOOTER_MM,
        leftMillimetres: cursorMm, topMillimetres: contactTopMm, color: NEUTRAL_500,
      })
    }
  }

  drawTextLine({
    text:            generatedByText,
    font:            regularFont,
    sizeMillimetres: CARD_FONT_FOOTER_MM,
    leftMillimetres: CARD_WIDTH_MM - CARD_MARGIN_MM - generatedByWidthMm,
    topMillimetres:  contentBottomMm - LINE_HEIGHT_FACTOR * CARD_FONT_FOOTER_MM,
    color:           NEUTRAL_500,
  })

  // ── Cut guide ───────────────────────────────────────────────────────────────────────────
  // The card's own outline doubles as the cut line: one hairline, so there is no second
  // rectangle to cut along and no doubt about which one is 85,6 mm wide.
  drawStrokedPath(page, cardPath(), NEUTRAL_200, millimetresToPoints(CARD_HAIRLINE_MM))

  const guideMaxWidthPt = millimetresToPoints(PAGE_WIDTH_MM - 2 * GUIDE_SIDE_MARGIN_MM)
  const guideLines = wrapToWidth(regularFont, sanitizeForWinAnsi(labels.cutGuide), GUIDE_FONT_SIZE_PT, guideMaxWidthPt, 2)
  guideLines.forEach((line, lineIndex) => {
    const lineWidthPt = regularFont.widthOfTextAtSize(line, GUIDE_FONT_SIZE_PT)
    page.drawText(line, {
      // Centred on the sheet rather than on the card: the sentence is much wider than 85,6 mm.
      x:     (millimetresToPoints(PAGE_WIDTH_MM) - lineWidthPt) / 2,
      y:     cardY(CARD_HEIGHT_MM + GUIDE_GAP_MM) - lineIndex * GUIDE_FONT_SIZE_PT * LINE_HEIGHT_FACTOR,
      size:  GUIDE_FONT_SIZE_PT,
      font:  regularFont,
      color: NEUTRAL_500,
    })
  })

  return Buffer.from(await pdfDocument.save())
}

function drawFilledPath(page: PDFPage, path: PDFOperator[], color: ReturnType<typeof rgb>) {
  page.pushOperators(pushGraphicsState(), setFillingColor(color), ...path, fill(), popGraphicsState())
}

function drawStrokedPath(
  page: PDFPage,
  path: PDFOperator[],
  color: ReturnType<typeof rgb>,
  lineWidthPt: number,
) {
  page.pushOperators(pushGraphicsState(), setStrokingColor(color), setLineWidth(lineWidthPt), ...path, stroke(), popGraphicsState())
}
