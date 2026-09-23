"use client"

import { useTranslations } from "next-intl"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { SelectField } from "@/components/ui/select-field"
import type { OnSitePaymentMethod } from "@/lib/evenement-payment-methods"
import type { DoorPaymentInput } from "@/hooks/use-evenements"

export type DoorPaymentMode = "now" | "later"

export interface DoorPaymentDraft {
  mode:          DoorPaymentMode
  ticketTypeId:  string
  paymentMethod: OnSitePaymentMethod
}

export interface DoorPaymentTicketType {
  id:    string
  label: string
  price: string
}

export function initialDoorPaymentDraft(params: {
  ticketTypes:       DoorPaymentTicketType[]
  availableMethods:  OnSitePaymentMethod[]
  preferredMethod?:  string | null
  preferredTierId?:  string | null
}): DoorPaymentDraft {
  const { ticketTypes, availableMethods, preferredMethod, preferredTierId } = params
  const preferredIsAvailable = availableMethods.includes(preferredMethod as OnSitePaymentMethod)
  return {
    mode:          "now",
    ticketTypeId:  preferredTierId ?? (ticketTypes.length === 1 ? ticketTypes[0].id : ""),
    paymentMethod: preferredIsAvailable ? (preferredMethod as OnSitePaymentMethod) : availableMethods[0],
  }
}

// A tier must be picked only when the event has several and nothing was resolved before.
export function doorPaymentDraftIsComplete(draft: DoorPaymentDraft, tierRequired: boolean): boolean {
  if (draft.mode === "later") return true
  return !tierRequired || !!draft.ticketTypeId
}

export function toDoorPaymentInput(draft: DoorPaymentDraft): DoorPaymentInput {
  if (draft.mode === "later") return { mode: "later" }
  return { mode: "now", ticketTypeId: draft.ticketTypeId || undefined, paymentMethod: draft.paymentMethod }
}

function formatEuros(amount: string | number): string {
  return Number(amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

// "Paiement" block shared by the presences page's add-guest, add-member and "Encaisser"
// dialogs. Flat on purpose (no container): a medium-weight title, the controls, muted help.
export function DoorPaymentFields({
  draft, onDraftChange, ticketTypes, availableMethods, showModeChoice, showTierSelect, amount,
}: {
  draft:            DoorPaymentDraft
  onDraftChange:    (draft: DoorPaymentDraft) => void
  ticketTypes:      DoorPaymentTicketType[]
  availableMethods: OnSitePaymentMethod[]
  // false in the "Encaisser" dialog, where paying is the whole point.
  showModeChoice:   boolean
  showTierSelect:   boolean
  // Shown when no tier select carries the price already (flat price, or a resolved tier).
  amount?:          string | number | null
}) {
  const t = useTranslations("evenements.presences.payment")
  const payingNow = draft.mode === "now"

  return (
    <div className="space-y-3">
      {showModeChoice && (
        <>
          <p className="text-sm font-medium text-foreground">{t("sectionTitle")}</p>
          <SegmentedControl<DoorPaymentMode>
            size="sm"
            className="w-full"
            ariaLabel={t("modeLabel")}
            value={draft.mode}
            onChange={(mode) => onDraftChange({ ...draft, mode })}
            options={[
              { value: "now",   label: t("modeNow") },
              { value: "later", label: t("modeLater") },
            ]}
          />
        </>
      )}

      {payingNow ? (
        <>
          {showTierSelect && (
            <SelectField
              id="door-payment-tier"
              label={t("tierLabel")}
              value={draft.ticketTypeId}
              onValueChange={(ticketTypeId) => onDraftChange({ ...draft, ticketTypeId })}
              options={ticketTypes.map(ticketType => ({
                value: ticketType.id,
                label: `${ticketType.label} — ${formatEuros(ticketType.price)}`,
              }))}
            />
          )}
          <div className="flex flex-col gap-1.5">
            <p className="text-sm leading-none font-medium text-foreground">{t("methodLabel")}</p>
            <SegmentedControl<OnSitePaymentMethod>
              size="sm"
              className="w-full"
              ariaLabel={t("methodLabel")}
              value={draft.paymentMethod}
              onChange={(paymentMethod) => onDraftChange({ ...draft, paymentMethod })}
              options={availableMethods.map(method => ({ value: method, label: t(`methods.${method}`) }))}
            />
          </div>
          {!showTierSelect && amount != null && (
            <p className="text-xs text-muted-foreground">{t("amountHint", { amount: formatEuros(amount) })}</p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t("laterHint")}</p>
      )}
    </div>
  )
}
