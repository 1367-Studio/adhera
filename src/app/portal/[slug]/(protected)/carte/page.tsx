"use client"

import { useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useFormatter, useTranslations } from "next-intl"
import { toast } from "sonner"
import { MemberCardActions } from "@/components/member-card/member-card-actions"
import { MemberCard, MemberCardSkeleton } from "@/components/member-card/member-card"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ViewToggle } from "@/components/ui/view-toggle"
import { usePortalMemberCards, type PortalMemberCard } from "@/hooks/use-portal-member-cards"
import { APP_TIME_ZONE } from "@/lib/date-format"
import { BASE_PATH } from "@/lib/env"

// The card keeps its printed 85,6 × 54 mm proportions and sizes itself from its container,
// so this slot is what decides how big it is: the full width of a phone, capped on a desktop
// at roughly the width a card is actually read at. Every state — card, skeleton, explanation
// — uses it, so switching between two people never moves the page around.
const CARD_SLOT_CLASS = "w-full max-w-md"

// The member's own card, plus one per person they are responsible for. Who that is comes
// from the session alone (see /api/portal/carte); this page only ever renders what it is
// given, and never asks for a member by id.
export default function PortalMemberCardPage() {
  const t        = useTranslations("memberCard.portal")
  const tCommon  = useTranslations("common")
  const { slug } = useParams<{ slug: string }>()

  const { data: memberCards, isLoading, isError } = usePortalMemberCards()
  const [selectedMembreId, setSelectedMembreId] = useState<string | null>(null)

  const household = memberCards ?? []
  // Falls back to the first person instead of syncing an effect once the query lands: the
  // selection is only a preference over a list that arrives later, and the account holder is
  // first, which is whose card they came for.
  const selectedPerson = household.find(person => person.membreId === selectedMembreId) ?? household[0]
  const switcherOptions = buildSwitcherOptions(household)

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {household.length > 1 ? t("titleMultiple") : t("title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <div className="space-y-4">
        {/* One person, one card: a switcher with a single option is just a label. */}
        {switcherOptions.length > 1 && (
          <ViewToggle
            options={switcherOptions}
            value={selectedPerson.membreId}
            onChange={setSelectedMembreId}
            ariaLabel={t("switcherLabel")}
          />
        )}

        {isLoading ? (
          <MemberCardSkeleton className={CARD_SLOT_CLASS} />
        ) : isError || !selectedPerson ? (
          <EmptyState className={CARD_SLOT_CLASS} title={tCommon("genericError")} />
        ) : selectedPerson.state === "valid" && selectedPerson.card ? (
          <div className="space-y-3">
            <MemberCard card={selectedPerson.card} className={CARD_SLOT_CLASS} />
            {/* The membreId is a selection inside the household the session already grants,
                never an address: /api/portal/carte/pdf rebuilds that list from the session
                and matches against it, exactly as /api/portal/carte does. */}
            <div className="flex flex-wrap gap-2">
              <MemberCardActions
                pdfUrl={`${BASE_PATH}/api/portal/carte/pdf?membreId=${selectedPerson.membreId}`}
                onError={message => toast.error(message)}
              />
            </div>
          </div>
        ) : (
          <MemberCardUnavailable person={selectedPerson} cotisationHref={`/portal/${slug}/cotisation`} />
        )}
      </div>
    </div>
  )
}

// Labels people by first name, which is how a household talks about itself, and only falls
// back to a last-name initial where two of them would otherwise read the same — two tabs
// spelled "Camille" would be unusable, while "Camille M." / "Camille D." still isn't a
// bureaucratic "MARTIN Camille".
function buildSwitcherOptions(household: PortalMemberCard[]) {
  const occurrencesByFirstName = new Map<string, number>()
  for (const person of household) {
    const normalizedFirstName = person.firstName.toLocaleLowerCase()
    occurrencesByFirstName.set(normalizedFirstName, (occurrencesByFirstName.get(normalizedFirstName) ?? 0) + 1)
  }

  return household.map(person => {
    const isAmbiguous     = (occurrencesByFirstName.get(person.firstName.toLocaleLowerCase()) ?? 0) > 1
    const lastNameInitial = person.lastName.trim().charAt(0).toLocaleUpperCase()
    return {
      value: person.membreId,
      label: isAmbiguous && lastNameInitial ? `${person.firstName} ${lastNameInitial}.` : person.firstName,
    }
  })
}

// What stands in the card's place when there is nothing to print. Deliberately the plain
// shared empty state and nothing else: a greyed-out mock card would look like a card that
// failed to load, and a warning colour would read as a problem with the member rather than
// a membership waiting on a payment.
function MemberCardUnavailable({ person, cotisationHref }: { person: PortalMemberCard; cotisationHref: string }) {
  const t         = useTranslations("memberCard.unavailable")
  const formatter = useFormatter()

  // Explicit time zone, like the card's own expiry: a cotisation covering a calendar year
  // ends at 31 December 23:59 Paris, which a browser set to UTC would print as the 30th.
  const formatDate = (isoDate: string) => formatter.dateTime(new Date(isoDate), {
    day: "numeric", month: "long", year: "numeric", timeZone: APP_TIME_ZONE,
  })

  // "Pay your cotisation" is only an answer while there is something to pay: a cancelled
  // membership and a member who never had one are the association's business, not an
  // invoice to settle, and pointing them at a payment screen would be a dead end.
  const { title, description, showsCotisationLink } = (() => {
    switch (person.state) {
      case "unavailable":
        return { title: t("title"), description: t(person.reason), showsCotisationLink: true }
      case "expired":
        return { title: t("title"), description: t("expired", { date: formatDate(person.expiredOn) }), showsCotisationLink: true }
      // "valid" only lands here when the card itself could not be built (a member removed
      // mid-request), which reads as "no card" like any other missing one.
      case "valid":
        return { title: t("noneTitle"), description: t("none"), showsCotisationLink: false }
      default:
        switch (person.reason) {
          // The association simply never turned the card on. Nothing here is about this
          // member's membership, so "aucune adhésion en cours" would be plainly untrue for
          // someone who is perfectly up to date.
          case "disabled":  return { title: t("noneTitle"), description: t("disabled"),  showsCotisationLink: false }
          case "cancelled": return { title: t("noneTitle"), description: t("cancelled"), showsCotisationLink: false }
          // "inactive-member" and "no-membership": the association's business either way,
          // and naming a suspension here would tell a member less than their manager will.
          default:          return { title: t("noneTitle"), description: t("none"),      showsCotisationLink: false }
        }
    }
  })()

  return (
    <EmptyState
      className={CARD_SLOT_CLASS}
      title={title}
      description={description}
      action={showsCotisationLink ? (
        // The section layout already gates this page on the cotisations module, so the link
        // can never point at a section the association turned off.
        <Button size="sm" variant="outline" nativeButton={false} render={<Link href={cotisationHref} />}>
          {t("viewCotisation")}
        </Button>
      ) : undefined}
    />
  )
}
