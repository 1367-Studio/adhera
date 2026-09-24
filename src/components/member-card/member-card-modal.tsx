"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { MemberCardActions } from "@/components/member-card/member-card-actions"
import { MemberCard, MemberCardSkeleton } from "@/components/member-card/member-card"
import { CotisationPaymentModal } from "@/components/cotisations/cotisation-payment-modal"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { EmptyState } from "@/components/ui/empty-state"
import { Modal } from "@/components/ui/modal"
import { useMemberCard, useRotateMemberCardToken } from "@/hooks/use-member-card"
import { BASE_PATH } from "@/lib/env"
import type { SerializedMemberCardEligibility } from "@/lib/member-card/wire"
import { useCurrentUser } from "@/lib/user-context"
import { cn } from "@/lib/utils"

// Mirrored from the two routes behind this modal, for the same reason the member sheet
// mirrors the role route's ADMIN/PRESIDENT check: showing an action the server would refuse
// is worse than not offering it. Rotating a card is an identity action (membres/[id]/carte/
// rotate), recording a payment a finance one (cotisations/[id]/paiements).
const CARD_ADMIN_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]
const FINANCE_ROLES    = ["ADMIN", "PRESIDENT", "TRESORIER"]

type CardFeedback = { kind: "success" | "error"; message: string }

interface MemberCardModalProps {
  membreId:     string
  /** Already assembled ("Camille Martin") — shown as the modal's description. */
  memberName:   string
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export function MemberCardModal({ membreId, memberName, open, onOpenChange }: MemberCardModalProps) {
  const translate   = useTranslations()
  const currentUser = useCurrentUser()

  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false)
  const [paymentOpen, setPaymentOpen]                     = useState(false)
  // Shown in the body rather than as a toast: this modal stays open after a rotation (the
  // point is to look at the new QR code), and a toast fired while a dialog is open renders
  // behind it and goes unseen — the same reason the send-email modal keeps its feedback
  // inline. Shared by every footer action, so a failed download reports itself the same way
  // a failed regeneration does, in the one place a manager is already looking.
  const [cardFeedback, setCardFeedback]                   = useState<CardFeedback | null>(null)

  // Only fetched while the modal is open, so the members table doesn't pull a card per row.
  const cardQuery      = useMemberCard(membreId, open)
  const rotateMutation = useRotateMemberCardToken(membreId)

  const card              = cardQuery.data?.card ?? null
  const pendingCotisation = cardQuery.data?.pendingCotisation ?? null
  const canRegenerate     = !!card && CARD_ADMIN_ROLES.includes(currentUser.role)
  const canRecordPayment  = !!pendingCotisation && pendingCotisation.remaining > 0 && FINANCE_ROLES.includes(currentUser.role)

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setCardFeedback(null)
    onOpenChange(nextOpen)
  }

  async function handleRegenerate() {
    setCardFeedback(null)
    try {
      await rotateMutation.mutateAsync()
      setConfirmRegenerateOpen(false)
      setCardFeedback({ kind: "success", message: translate("memberCard.manager.regenerated") })
    } catch (error) {
      // Swallowed on purpose: ConfirmDialog turns a thrown error into a toast, which this
      // modal would hide. The message goes into the body instead.
      setConfirmRegenerateOpen(false)
      setCardFeedback({
        kind:    "error",
        message: error instanceof Error ? error.message : translate("common.error"),
      })
    }
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={handleOpenChange}
        title={translate("memberCard.manager.modalTitle")}
        description={memberName}
        size="md"
        // Printing and downloading need a card to print; regenerating additionally needs the
        // right role. An expired card is still printable, which is exactly when a manager
        // needs the sheet in hand at the door.
        footer={card || canRegenerate ? (
          <>
            {card && (
              <MemberCardActions
                pdfUrl={`${BASE_PATH}/api/membres/${membreId}/carte/pdf`}
                onError={message => setCardFeedback({ kind: "error", message })}
              />
            )}
            {canRegenerate && (
              <Button variant="outline" onClick={() => setConfirmRegenerateOpen(true)}>
                {translate("memberCard.manager.regenerate")}
              </Button>
            )}
          </>
        ) : undefined}
      >
        {cardQuery.isPending ? (
          <MemberCardSkeleton />
        ) : cardQuery.isError ? (
          <EmptyState title={cardQuery.error instanceof Error ? cardQuery.error.message : translate("common.error")} />
        ) : card ? (
          <div className="space-y-3">
            {/* An expired membership still prints its card — the component labels it
                "Adhésion expirée" itself, which is what a manager checking a door list needs
                to see rather than an empty panel. */}
            <MemberCard card={card} />
            {cardFeedback && (
              <p
                role="status"
                className={cn("text-xs", cardFeedback.kind === "error" ? "text-destructive" : "font-medium text-foreground")}
              >
                {cardFeedback.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{translate("memberCard.manager.settingsHint")}</p>
          </div>
        ) : (
          <MemberCardUnavailablePanel
            eligibility={cardQuery.data}
            onRecordPayment={canRecordPayment ? () => setPaymentOpen(true) : null}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={confirmRegenerateOpen}
        onOpenChange={setConfirmRegenerateOpen}
        title={translate("memberCard.manager.regenerateConfirm")}
        description={translate("memberCard.manager.regenerateHint")}
        confirmLabel={translate("memberCard.manager.regenerate")}
        loading={rotateMutation.isPending}
        onConfirm={handleRegenerate}
      />

      {/* Recording the payment invalidates ["membres"], which this card's query key sits
          under — so the empty panel turns into the freshly valid card on its own, which is
          also the only visible confirmation: this modal stays open over the payment one, and
          the success toast it fires would render behind both. */}
      {pendingCotisation && (
        <CotisationPaymentModal
          cotisationId={pendingCotisation.id}
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
        />
      )}
    </>
  )
}

// What stands in the card's place, and *why*. The route answers with the whole eligibility
// union (see /api/membres/[id]/carte), so the reason is already on the wire and this panel
// never has to guess: telling a manager "aucun paiement enregistré" about a member who is
// perfectly up to date — but whose association never turned the card on, or who was suspended
// — is worse than saying nothing. Same wording as the member's own page reads
// (portal/[slug]/carte), through the same memberCard.unavailable.* keys, so a manager and the
// member they are helping are never told two different stories.
function MemberCardUnavailablePanel({
  eligibility,
  onRecordPayment,
}: {
  eligibility: SerializedMemberCardEligibility
  /** null unless a payment is what unlocks the card *and* this manager may record one. */
  onRecordPayment: (() => void) | null
}) {
  const translate = useTranslations("memberCard")

  const { title, description, offersPayment } = (() => {
    switch (eligibility.state) {
      // pending / partial / late — the only states where money is what stands in the way, and
      // therefore the only ones where recording a payment is the manager's next move.
      case "unavailable":
        return {
          title:         translate("manager.unavailableTitle"),
          description:   translate("manager.noPayment"),
          offersPayment: true,
        }
      case "none":
        switch (eligibility.reason) {
          // The association simply never enabled the card: nothing here is about this member.
          case "disabled":
            return { title: translate("unavailable.noneTitle"), description: translate("unavailable.disabled"),  offersPayment: false }
          case "cancelled":
            return { title: translate("unavailable.noneTitle"), description: translate("unavailable.cancelled"), offersPayment: false }
          // "inactive-member" (suspended, soft-deleted) and "no-membership": the member sheet
          // above already shows the status, so repeating it here would add nothing.
          default:
            return { title: translate("unavailable.noneTitle"), description: translate("unavailable.none"),      offersPayment: false }
        }
      // "valid"/"expired" only land here when the card itself could not be built (a member
      // removed mid-request), which reads as "no card" like any other missing one.
      default:
        return { title: translate("unavailable.noneTitle"), description: translate("unavailable.none"), offersPayment: false }
    }
  })()

  return (
    <EmptyState
      title={title}
      description={description}
      action={offersPayment && onRecordPayment ? (
        <Button variant="outline" size="sm" onClick={onRecordPayment}>
          {translate("manager.recordPayment")}
        </Button>
      ) : undefined}
    />
  )
}
