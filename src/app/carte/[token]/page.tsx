import type { Metadata } from "next"
import { headers } from "next/headers"
import { getLocale, getTranslations } from "next-intl/server"
import { BrandLogo } from "@/components/layout/brand-logo"
import { Separator } from "@/components/ui/separator"
import { APP_NAME } from "@/config/brand"
import { loadMemberCardEligibility } from "@/lib/member-card/loader"
import { MEMBER_CARD_TOKEN_PATTERN } from "@/lib/member-card/token"
import {
  formatMemberCardCheckedAt,
  formatMemberCardVerifyDate,
  memberCardVerifyDisplay,
  type MemberCardVerifyDisplay,
} from "@/lib/member-card/verify-display"
import { prisma } from "@/lib/prisma/client"
import { ipFromHeaders, rateLimit } from "@/lib/rate-limit"
import { cn } from "@/lib/utils"
import { MemberCardCheckedAtClock } from "./checked-at-clock"

const VERIFY_WINDOW_MS       = 10 * 60_000
const VERIFY_LIMIT_PER_TOKEN = 30
// Far more generous than the per-token budget, deliberately: at a door every phone sits
// behind the same venue Wi-Fi/NAT and shares this bucket, so the limit only has to be low
// enough to make walking the token space pointless, not low enough to inconvenience a queue.
const VERIFY_LIMIT_PER_IP    = 120

// noindex, nofollow: the page is public in the sense that anyone who can scan the QR code
// can read it, but a card URL must never end up in a search index — that would turn a
// per-member secret into a crawlable one. No title of our own on purpose either: the root
// layout's default (APP_NAME) says nothing about the member or the card's state, where any
// title we set would leak it into the tab, the browser history and every link preview.
export function generateMetadata(): Metadata {
  return { robots: { index: false, follow: false } }
}

const TOP_BORDER_CLASS: Record<MemberCardVerifyDisplay["state"], string> = {
  valid:   "border-green-600",
  expired: "border-red-600",
  invalid: "border-neutral-400",
}

// Public verification page behind Membre.cardToken — where the QR code printed on a member
// card lands (see memberCardVerificationUrl). No login: the token is the access control,
// exactly like /billet/[token] and /cotisation/[token].
//
// A server component rather than the client page /billet uses, for two reasons: it needs
// generateMetadata for the noindex above, and it can then read the database directly instead
// of shipping a /api/public/carte/[token] route. That route would only add a second public
// surface returning a member's data as JSON, with its own copy of the token check, the rate
// limits and the what-may-be-shown rules to keep in sync — for a page that renders once and
// never refetches.
export default async function MemberCardVerifyPage(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  const display   = await resolveMemberCardVerifyDisplay(token)
  const locale    = await getLocale()
  const translate = await getTranslations("memberCard.verify")
  const checkedAt = formatMemberCardCheckedAt(new Date(), locale)

  return (
    // The 4px edge at the top of the page is the signal a phone camera reads from two metres
    // away, before any text. Never the *only* signal: each state also has its own glyph and
    // its own wording, so it survives colour-blindness and a bad screen.
    <main className={cn("min-h-screen border-t-4 bg-background", TOP_BORDER_CLASS[display.state])}>
      <div className="mx-auto max-w-sm px-4 py-10 text-center">
        {display.state === "invalid" ? (
          // Nothing else: no association, no name, no reason. An unknown token, a revoked
          // one, a member whose cotisation isn't paid and an association that switched the
          // card off are all indistinguishable from here, which is the point.
          <>
            <h1 className="text-xl font-semibold">{translate("invalid")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{translate("invalidText")}</p>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3">
              {display.identity.associationLogoUrl && (
                // hideWhenMissing: a logo that 404s leaves this page with no logo at all,
                // never the platform's own mark — the card's rule (see
                // MemberCardViewModel.logoUrl), and here it would also read as *Formwise*
                // vouching for the member rather than the association named just below.
                <BrandLogo
                  logoUrl={display.identity.associationLogoUrl}
                  imgClassName="h-12 max-w-40 object-contain"
                  hideWhenMissing
                />
              )}
              <p className="text-sm text-muted-foreground">{display.identity.associationName}</p>
            </div>

            <Separator className="my-6" />

            {display.state === "valid" ? (
              <>
                <h1 className="text-xl font-semibold text-green-700 dark:text-green-400">
                  <span aria-hidden="true">✓ </span>{translate("valid")}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {translate("validUntil", { date: formatMemberCardVerifyDate(display.validUntil, locale) })}
                </p>
              </>
            ) : (
              // The member's name stays on screen for an expired card: whoever is at the
              // desk has to tell the person in front of them what to renew.
              <>
                <h1 className="text-xl font-semibold text-red-700 dark:text-red-400">
                  <span aria-hidden="true">✕ </span>{translate("expired")}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {translate("expiredSince", { date: formatMemberCardVerifyDate(display.expiredOn, locale) })}
                </p>
              </>
            )}

            <p className="mt-6 text-2xl font-semibold tracking-tight">{display.identity.memberName}</p>
            {display.identity.categoryName && (
              <p className="mt-1 text-sm text-muted-foreground">{display.identity.categoryName}</p>
            )}

            <MemberCardCheckedAtClock
              initialCheckedAt={checkedAt}
              locale={locale}
              className="mt-6 block text-xs text-muted-foreground"
            />
          </>
        )}

        <p className="mt-10 text-xs text-muted-foreground">{translate("poweredBy", { appName: APP_NAME })}</p>
      </div>
    </main>
  )
}

async function resolveMemberCardVerifyDisplay(token: string): Promise<MemberCardVerifyDisplay> {
  // Shape first, so a crawler or a scanner that mangled the URL never reaches the database.
  if (!MEMBER_CARD_TOKEN_PATTERN.test(token)) return { state: "invalid" }

  // Two buckets. By token, like /api/public/billet — re-opening the same card a few times at
  // a door is normal. By IP as well, which the billet route deliberately skips: a ticket
  // token is handed to its holder, while a card token is the only thing between a stranger
  // and "is this person a member of that association?", so a single host walking the token
  // space has to be slowed down even though 128 bits already makes that hopeless.
  const ipAddress = ipFromHeaders(await headers())
  const [tokenAllowed, ipAllowed] = await Promise.all([
    rateLimit(`member-card-verify:${token}`, VERIFY_LIMIT_PER_TOKEN, VERIFY_WINDOW_MS),
    rateLimit(`member-card-verify-ip:${ipAddress}`, VERIFY_LIMIT_PER_IP, VERIFY_WINDOW_MS),
  ])
  // Rendered as an invalid card rather than a raw 429 page: the person holding the phone is
  // standing at a door, and "carte non valide, adressez-vous à l'association" is something
  // they can act on where an error page is not. It also stops a client enumerating tokens
  // from telling "you are going too fast" apart from "no such card".
  if (!tokenAllowed || !ipAllowed) return { state: "invalid" }

  // cardToken is unique platform-wide, so this one lookup is also what resolves the tenant:
  // everything after it goes through loadMemberCardEligibility scoped to that association,
  // and a rotated (revoked) token simply matches no row. The extra round-trip over querying
  // the member directly buys the loader's settings parsing, branding gating and eligibility
  // precedence instead of a second copy of those rules living in this page.
  const membre = await prisma.membre.findUnique({
    where:  { cardToken: token },
    select: { id: true, associationId: true },
  })
  if (!membre) return { state: "invalid" }

  return memberCardVerifyDisplay(await loadMemberCardEligibility(membre.associationId, membre.id))
}
