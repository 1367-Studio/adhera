"use client"

import type { CSSProperties } from "react"
import { useFormatter, useTranslations } from "next-intl"
import { PhoneIcon } from "@phosphor-icons/react/dist/ssr"
import { QRCodeSVG } from "qrcode.react"
import { APP_NAME } from "@/config/brand"
import { APP_TIME_ZONE } from "@/lib/date-format"
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
  CARD_IDENTITY_ROW_GAP_MM,
  CARD_IDENTITY_TOP_GAP_MM,
  CARD_LOGO_MAX_HEIGHT_MM,
  CARD_LOGO_MAX_WIDTH_MM,
  CARD_LOGO_TILE_PADDING_MM,
  CARD_LOGO_TILE_RADIUS_MM,
  CARD_MARGIN_MM,
  CARD_PHOTO_DIAMETER_MM,
  CARD_QR_SIZE_MM,
  CARD_TOP_STRIP_HEIGHT_MM,
  CARD_WIDTH_MM,
} from "@/lib/member-card/layout"
import type { MemberCardViewModel } from "@/lib/member-card/view-model"
import { cn } from "@/lib/utils"

// ── Why this component breaks two house rules on purpose ─────────────────────────────────
//
// 1. Arbitrary values. The card is an ISO/IEC 7810 ID-1 object (see layout.ts): its geometry
//    is fixed in millimetres, not in Tailwind spacing tokens. The root declares a `--mm` unit
//    equal to one millimetre of card width (`100cqw / 85.6`, resolved against its own
//    container) and every length is `calc(n * var(--mm))` built from a layout.ts constant —
//    so the card scales to any width while keeping its exact printed proportions, and the
//    phase-6 PDF renderer reads the same numbers. These are the only arbitrary values in the
//    feature, and no magic number is allowed here: it belongs in layout.ts.
//
// 2. Hard-coded colours. The card surface is always light, dark mode included: it is a
//    printed artifact, and a QR code is only readable as dark-on-light. Semantic tokens flip
//    with the theme, which would invert a card that must not invert — so white/neutral/green/
//    red are literal here. The only token used is `border`, for the frame that separates the
//    card from the page around it.

/** One length of the card's millimetre grid. See the note above for `--mm`. */
function millimetres(lengthInMillimetres: number): string {
  return `calc(${lengthInMillimetres} * var(--mm))`
}

interface MemberCardProps {
  card:       MemberCardViewModel
  className?: string
}

export function MemberCard({ card, className }: MemberCardProps) {
  const t         = useTranslations("memberCard.card")
  const formatter = useFormatter()

  const { settings } = card
  const accentColor  = resolveMemberCardColor(settings.color)
  const isModern     = settings.template === "modern"
  const isMinimal    = settings.template === "minimal"

  // `modern` paints the whole header band, so its text and its logo tile have to fight the
  // colour; `classic` and `minimal` leave the header on white and separate it with a hairline.
  const headerTextColor = isModern ? getContrastingTextColor(accentColor) : undefined
  const colorLayerHeightMm = isModern ? CARD_HEADER_BAND_HEIGHT_MM : CARD_TOP_STRIP_HEIGHT_MM

  // Initials stand in for a missing photo; only `classic` tints them with the association's
  // colour, the other two keep them neutral.
  const showsAccentInitials  = !card.photoUrl && settings.template === "classic"
  const showsNeutralInitials = !card.photoUrl && settings.template !== "classic"

  // Explicit time zone rather than the runtime's: a card rendered on the server (PDF, scan
  // page) and one rendered in the member's browser must print the same dates.
  const dateFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric", timeZone: APP_TIME_ZONE } as const
  const validUntilLabel = formatter.dateTime(card.validUntil, dateFormatOptions)
  // Only a valid card has a start date to show (see MemberCardViewModel.validFrom) — an
  // expired one prints the single day it stopped covering, via card.expiredOn below.
  //
  // `from` never carries a year, `to` always does — not just when they happen to match.
  // Measured against the printed font, "Valable du 01/01/2026 au 31/12/2026" plus "Carte
  // générée via Formwise" overruns this row's width in every locale checked; dropping the
  // year only when the two years matched (tried first) still left the far more common case
  // of a rolling 12-month membership — a real signup date to a real anniversary a year
  // later, i.e. two *different* years — overrunning just the same, which a member hit
  // immediately in the settings preview (today to +1 year always differs in year outside a
  // narrow window). `to` is the date a member actually needs to see and must never be the
  // one CSS truncation eats; unconditionally shortening `from` is what makes that guarantee
  // hold regardless of which two years are involved.
  const validFromLabel = card.validFrom
    ? formatter.dateTime(card.validFrom, { day: "2-digit", month: "2-digit", timeZone: APP_TIME_ZONE })
    : null

  return (
    <section
      aria-label={t("ariaLabel", { name: card.memberName })}
      // aspect-[85.6/53.98] mirrors CARD_WIDTH_MM / CARD_HEIGHT_MM — Tailwind cannot read a
      // TypeScript constant, and the ratio must live on the container that `--mm` measures.
      className={cn("@container w-full aspect-[85.6/53.98]", className)}
    >
      <div
        style={{
          "--mm":       `calc(100cqw / ${CARD_WIDTH_MM})`,
          borderRadius: millimetres(CARD_CORNER_RADIUS_MM),
        } as CSSProperties}
        className="relative flex h-full w-full flex-col overflow-hidden border bg-white text-neutral-950"
      >
        {/* Full-bleed colour: a thin top strip (classic) or the whole header band (modern).
            Templates only ever change colour — no element moves between them, so a member
            who knows their card recognises it whatever the association picks. */}
        {!isMinimal && (
          <div
            aria-hidden
            className="absolute inset-x-0 top-0"
            style={{ height: millimetres(colorLayerHeightMm), backgroundColor: accentColor }}
          />
        )}

        <div
          className="relative flex h-full flex-col"
          style={{
            paddingLeft:   millimetres(CARD_MARGIN_MM),
            paddingRight:  millimetres(CARD_MARGIN_MM),
            paddingBottom: millimetres(CARD_MARGIN_MM),
          }}
        >
          <header
            className={cn("flex shrink-0 items-center", !isModern && "border-b border-neutral-200")}
            style={{
              height:           millimetres(CARD_HEADER_BAND_HEIGHT_MM),
              gap:              millimetres(CARD_GUTTER_MM),
              borderBottomWidth: isModern ? undefined : millimetres(CARD_HAIRLINE_MM),
            }}
          >
            {card.logoUrl && (
              <div
                className="flex shrink-0 items-center justify-start"
                style={{
                  // The tile only exists on `modern`, where a dark logo would otherwise sit on
                  // a dark band; elsewhere the logo sits straight on the white card.
                  maxWidth:     millimetres(CARD_LOGO_MAX_WIDTH_MM + (isModern ? 2 * CARD_LOGO_TILE_PADDING_MM : 0)),
                  height:       millimetres(CARD_LOGO_MAX_HEIGHT_MM + (isModern ? 2 * CARD_LOGO_TILE_PADDING_MM : 0)),
                  ...(isModern ? {
                    backgroundColor: "#ffffff",
                    padding:         millimetres(CARD_LOGO_TILE_PADDING_MM),
                    borderRadius:    millimetres(CARD_LOGO_TILE_RADIUS_MM),
                  } : {}),
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- association logo from R2, any aspect ratio, never optimised through next/image */}
                <img src={card.logoUrl} alt="" className="h-full w-full object-contain object-left" />
              </div>
            )}
            <p
              className="min-w-0 truncate font-semibold uppercase leading-tight"
              style={{
                fontSize:      millimetres(CARD_FONT_ASSOCIATION_NAME_MM),
                letterSpacing: millimetres(CARD_ASSOCIATION_NAME_TRACKING_MM),
                color:         headerTextColor,
              }}
            >
              {card.associationName}
            </p>
          </header>

          {/* Identity row — top-aligned, so hiding the category (or the photo) never shifts
              the QR or the validity block below. */}
          <div
            className="flex min-h-0 flex-1 items-start"
            style={{ gap: millimetres(CARD_GUTTER_MM), paddingTop: millimetres(CARD_IDENTITY_TOP_GAP_MM) }}
          >
            {/* Hidden outright when the association turned photos off — the text column then
                starts at the left margin rather than beside an empty circle. */}
            {settings.showPhoto && (
              <div
                className={cn(
                  "flex shrink-0 items-center justify-center overflow-hidden rounded-full border-solid border-neutral-200",
                  showsNeutralInitials && "bg-neutral-100 text-neutral-600",
                )}
                style={{
                  width:       millimetres(CARD_PHOTO_DIAMETER_MM),
                  height:      millimetres(CARD_PHOTO_DIAMETER_MM),
                  borderWidth: millimetres(CARD_HAIRLINE_MM),
                  // `classic` fills the initials with the association's colour — its only
                  // second use of the colour besides the top strip.
                  ...(showsAccentInitials
                    ? { backgroundColor: accentColor, color: getContrastingTextColor(accentColor) }
                    : {}),
                }}
              >
                {card.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- member photo from R2, cropped to the circle
                  <img src={card.photoUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-semibold leading-none" style={{ fontSize: millimetres(CARD_FONT_INITIALS_MM) }}>
                    {card.initials}
                  </span>
                )}
              </div>
            )}

            <div className="flex min-w-0 flex-1 flex-col" style={{ gap: millimetres(CARD_IDENTITY_ROW_GAP_MM) }}>
              <p
                className="line-clamp-2 font-semibold leading-tight"
                style={{ fontSize: millimetres(CARD_FONT_MEMBER_NAME_MM) }}
              >
                {card.memberName}
              </p>
              {settings.showCategory && card.category && (
                <p
                  className="truncate leading-tight text-neutral-600"
                  style={{ fontSize: millimetres(CARD_FONT_BODY_MM) }}
                >
                  {card.category}
                </p>
              )}
            </div>

            {/* Black on white whatever the template: a tinted or logo-filled QR is the first
                thing to fail a scan, and the white card around it doubles as the quiet zone. */}
            <div
              className="shrink-0 bg-white"
              style={{ width: millimetres(CARD_QR_SIZE_MM), height: millimetres(CARD_QR_SIZE_MM) }}
            >
              <QRCodeSVG
                value={card.verificationUrl}
                level="M"
                bgColor="#ffffff"
                fgColor="#000000"
                role="img"
                aria-label={t("qrAlt")}
                className="h-full w-full"
              />
            </div>
          </div>

          {/* The association's own phone / e-mail, one gap above the validity line and toned
              like the "généré via Formwise" mention: it is a way to reach the association, not
              something about this member. A row of its own rather than a line inside the block
              below, so it gets the same width the PDF gives it — sharing the row would let the
              "généré via" column squeeze it and the two renderers would cut it in different
              places. Capped one gutter short of the QR column (CARD_CONTACT_MAX_WIDTH_MM) and
              truncated, never wrapped: a second line would push the validity off the card's
              baseline. Absent entirely when there is nothing to show, so nothing moves. */}
          {card.contactLine && (
            <p
              className="flex shrink-0 items-center overflow-hidden leading-tight text-neutral-500"
              style={{
                fontSize:     millimetres(CARD_FONT_FOOTER_MM),
                maxWidth:     millimetres(CARD_CONTACT_MAX_WIDTH_MM),
                marginBottom: millimetres(CARD_CONTACT_GAP_MM),
              }}
            >
              {/* The glyph marks this as a phone number rather than another line of prose — the
                  number alone, next to an e-mail, reads ambiguous at footer size. Never
                  truncated (shrink-0): a phone number is short and always fits, so the e-mail
                  after it is the one that gives way when the line runs out of room. */}
              {card.contactPhone && (
                <span className="inline-flex shrink-0 items-center" style={{ gap: millimetres(CARD_CONTACT_ICON_GAP_MM) }}>
                  <PhoneIcon aria-hidden style={{ width: millimetres(CARD_CONTACT_ICON_SIZE_MM), height: millimetres(CARD_CONTACT_ICON_SIZE_MM) }} />
                  {card.contactPhone}
                </span>
              )}
              {card.contactPhone && card.contactEmail && (
                <span aria-hidden className="shrink-0" style={{ paddingInline: millimetres(CARD_CONTACT_SEPARATOR_GAP_MM) }}>
                  ·
                </span>
              )}
              {card.contactEmail && <span className="min-w-0 truncate">{card.contactEmail}</span>}
            </p>
          )}

          {/* Validity and status — bottom-aligned for the same reason the identity is
              top-aligned: this block sits on the card's baseline whatever is shown above. */}
          <div
            className="flex shrink-0 items-end justify-between"
            style={{ gap: millimetres(CARD_GUTTER_MM) }}
          >
            <div className="min-w-0">
              <p className="truncate leading-tight text-neutral-600" style={{ fontSize: millimetres(CARD_FONT_BODY_MM) }}>
                {card.state === "valid" && validFromLabel
                  ? t("validPeriod", { from: validFromLabel, to: validUntilLabel })
                  : t("expiredOn", { date: validUntilLabel })}
              </p>
              <p
                className={cn("truncate font-medium leading-tight", card.state === "valid" ? "text-green-700" : "text-red-700")}
                style={{ fontSize: millimetres(CARD_FONT_BODY_MM) }}
              >
                {/* The glyph is decoration; the words carry the meaning, for a screen reader
                    and for anyone who cannot tell the green from the red. */}
                <span aria-hidden>{card.state === "valid" ? "✓" : "✕"}</span>{" "}
                {t(card.state === "valid" ? "status.valid" : "status.expired")}
              </p>
            </div>
            <p className="shrink-0 leading-tight text-neutral-500" style={{ fontSize: millimetres(CARD_FONT_FOOTER_MM) }}>
              {t("generatedBy", { appName: APP_NAME })}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Placeholder with the card's exact footprint, so a portal or modal that loads its card
 * asynchronously (phases 3–5) reserves the right space instead of jumping once it arrives.
 */
export function MemberCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("w-full aspect-[85.6/53.98] animate-pulse rounded-lg bg-muted", className)}
    />
  )
}
