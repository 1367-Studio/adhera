// The member card is a *physical* object before it is a screen one: ISO/IEC 7810 ID-1, the
// same 85.6 × 53.98 mm as a bank card, so a printed card slides into a wallet and a scanner
// meets the QR at the size it was designed for. Every length below is therefore in
// millimetres — not in Tailwind spacing tokens, which have no physical meaning once the card
// leaves the screen (see CLAUDE.md §2: this is the "genuine layout requirement" exception).
//
// One module, two renderers: the React card (src/components/member-card/member-card.tsx)
// turns these into CSS via a `--mm` unit derived from its own width, and the PDF renderer
// (phase 6) draws them at their true size. Neither is allowed to hard-code a number, so a
// card printed from the PDF and a card shown on screen stay the same card.

/** ID-1 card width. */
export const CARD_WIDTH_MM = 85.6
/** ID-1 card height. */
export const CARD_HEIGHT_MM = 53.98
/** ID-1 corner radius. */
export const CARD_CORNER_RADIUS_MM = 3.18

/** Quiet edge kept clear of content on all four sides. */
export const CARD_MARGIN_MM = 4
/** Horizontal gap between the card's three columns (photo / text / QR). */
export const CARD_GUTTER_MM = 3
/** Hairline separators (header divider, photo ring) — thin, but still visible in print. */
export const CARD_HAIRLINE_MM = 0.2

/**
 * QR side. 20 mm keeps a ~2.5 cm scan distance comfortable for a phone camera; a printed QR
 * below MIN stops resolving reliably, so no template may shrink it past that.
 */
export const CARD_QR_SIZE_MM = 20
export const CARD_QR_MIN_SIZE_MM = 18

/** Member photo — a circle, so this is the diameter. */
export const CARD_PHOTO_DIAMETER_MM = 16

/** Box the association logo is fitted inside (object-contain: any aspect ratio is welcome). */
export const CARD_LOGO_MAX_WIDTH_MM = 20
export const CARD_LOGO_MAX_HEIGHT_MM = 8
/** `modern` only: the white tile the logo sits on, so a dark logo survives the coloured band. */
export const CARD_LOGO_TILE_PADDING_MM = 1
export const CARD_LOGO_TILE_RADIUS_MM = 0.8

/** Header (logo + association name) band, measured from the top edge. */
export const CARD_HEADER_BAND_HEIGHT_MM = 14.5
/** `classic` only: the full-bleed colour strip on the very top edge. */
export const CARD_TOP_STRIP_HEIGHT_MM = 1.5
/** Gap between the header band and the identity row below it. */
export const CARD_IDENTITY_TOP_GAP_MM = 2.5
/** Gap between the member's name and their category. */
export const CARD_IDENTITY_ROW_GAP_MM = 0.8

/** Gap between the association's contact line and the validity line right below it. */
export const CARD_CONTACT_GAP_MM = 1.2
/**
 * Width the association's contact line may occupy before it is truncated. It stops one gutter
 * short of the QR column so nothing ever sits under the code and the QR's quiet zone stays
 * intact — the line lives in the bottom-left block, but a long "téléphone · e-mail" pair would
 * otherwise run straight across the card. 54,6 mm at today's constants.
 */
export const CARD_CONTACT_MAX_WIDTH_MM = CARD_WIDTH_MM - 2 * CARD_MARGIN_MM - CARD_GUTTER_MM - CARD_QR_SIZE_MM
/** Letter-spacing of the uppercased association name — uppercase needs air to stay readable. */
export const CARD_ASSOCIATION_NAME_TRACKING_MM = 0.06

// Type sizes, in millimetres of cap-to-cap em size for the same reason as the lengths above.
export const CARD_FONT_ASSOCIATION_NAME_MM = 3.2
export const CARD_FONT_MEMBER_NAME_MM = 4.0
export const CARD_FONT_BODY_MM = 2.8
export const CARD_FONT_FOOTER_MM = 2.1
/** Initials shown in place of a missing photo — sized to fill the photo circle. */
export const CARD_FONT_INITIALS_MM = 6
