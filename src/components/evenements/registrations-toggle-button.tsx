"use client"

import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useToggleRegistrations, type RegistrationsToggleAction } from "@/hooks/use-evenements"
import { isEvenementOver } from "@/lib/evenement-timing"
import { LockSimpleIcon, LockSimpleOpenIcon } from "@phosphor-icons/react/dist/ssr"
import { useTranslations } from "next-intl"
import { useState } from "react"
import { toast } from "sonner"

export type RegistrationsToggleEvenement = {
  id:                    string
  status:                string
  date:                  string
  endDate:               string | null
  registrationsClosedAt: string | null
}

// Closing/reopening online registrations only makes sense while the event is live on the
// public link — a draft/archived or already-over event takes no registrations anyway.
export function areRegistrationsControllable(evenement: RegistrationsToggleEvenement) {
  return evenement.status === "PUBLISHED" && !isEvenementOver(evenement)
}

/** Muted "Inscriptions closes" text for a page header, shown only while it is actionable. */
export function RegistrationsClosedNotice({ evenement }: { evenement: RegistrationsToggleEvenement }) {
  const t = useTranslations("evenements.detail")
  if (!areRegistrationsControllable(evenement) || !evenement.registrationsClosedAt) return null
  return <span className="text-xs text-muted-foreground">{t("registrationsClosedNotice")}</span>
}

/** Header action to manually close (with confirmation) or reopen the event's online registrations. */
export function RegistrationsToggleButton({ evenement }: { evenement: RegistrationsToggleEvenement }) {
  const t       = useTranslations("evenements.detail")
  const tCommon = useTranslations("common")
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const toggleRegistrations = useToggleRegistrations(evenement.id)

  if (!areRegistrationsControllable(evenement)) return null

  function runToggle(action: RegistrationsToggleAction) {
    toggleRegistrations.mutate(action, {
      onSuccess: () => {
        if (action === "closeRegistrations") {
          setCloseConfirmOpen(false)
          toast.success(t("toasts.registrationsClosed"))
          return
        }
        toast.success(t("toasts.registrationsReopened"))
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : tCommon("error")),
    })
  }

  return (
    <>
      {evenement.registrationsClosedAt ? (
        <Button size="sm" variant="outline" onClick={() => runToggle("reopenRegistrations")} loading={toggleRegistrations.isPending}>
          <LockSimpleOpenIcon className="mr-1.5 size-4" />
          {t("reopenRegistrationsButton")}
        </Button>
      ) : (
        <Button size="sm" variant="destructive" onClick={() => setCloseConfirmOpen(true)} loading={toggleRegistrations.isPending}>
          <LockSimpleIcon className="mr-1.5 size-4" />
          {t("closeRegistrationsButton")}
        </Button>
      )}

      <ConfirmDialog
        open={closeConfirmOpen}
        onOpenChange={setCloseConfirmOpen}
        title={t("closeRegistrationsConfirmTitle")}
        description={t("closeRegistrationsConfirmDescription")}
        confirmLabel={t("closeRegistrationsButton")}
        confirmVariant="destructive"
        loading={toggleRegistrations.isPending}
        onConfirm={() => runToggle("closeRegistrations")}
      />
    </>
  )
}
