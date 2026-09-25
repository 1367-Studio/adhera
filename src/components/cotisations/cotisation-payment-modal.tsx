"use client"

import { useMemo, useState } from "react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { DateField } from "@/components/ui/date-field"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { useAddCotisationPayment, useCotisationPaymentSchedule } from "@/hooks/use-cotisations"
import { Modal } from "@/components/ui/modal"
import { CurrencyField } from "@/components/ui/currency-field"
import { SelectField } from "@/components/ui/select-field"
import { FormField } from "@/components/ui/form-field"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { installmentBalances, type DisplayInstallment } from "@/lib/cotisation-display"
import { cn } from "@/lib/utils"

type Method = "CB" | "CHQ" | "ESP" | "VIR" | "En ligne" | "Autre"

const methodOptions: { value: Method; label: string }[] = [
  { value: "CB",       label: "CB"       },
  { value: "CHQ",      label: "CHQ"      },
  { value: "ESP",      label: "ESP"      },
  { value: "VIR",      label: "Virement" },
  { value: "En ligne", label: "En ligne" },
  { value: "Autre",    label: "Autre"    },
]

const EPSILON = 0.01
const CUSTOM_CHOICE = "custom"

const formatEuros = (value: number) => value.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

/** What the modal needs to know about the cotisation's balance and échéancier. */
export type CotisationPaymentScheduleInput = {
  amount:       number
  amountPaid:   number
  installments: DisplayInstallment[]
}

interface Props {
  cotisationId: string
  /** Pass it when the caller already holds the cotisation with its échéancier (the Cotisations
   *  list). Left out, the modal loads it itself — the member page and the member card only
   *  carry the balance, and guessing without the échéances pre-filled the whole remaining
   *  amount, which is how a three-échéance cotisation ended up paid at once. */
  schedule?:    CotisationPaymentScheduleInput
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export function CotisationPaymentModal({ cotisationId, schedule, open, onOpenChange }: Props) {
  const t = useTranslations()
  const scheduleQuery = useCotisationPaymentSchedule(cotisationId, open && !schedule)

  const resolvedSchedule: CotisationPaymentScheduleInput | null = useMemo(() => {
    if (schedule) return schedule
    if (!scheduleQuery.data) return null
    return {
      amount:       Number(scheduleQuery.data.amount),
      amountPaid:   Number(scheduleQuery.data.amountPaid),
      installments: scheduleQuery.data.installments.map(installment => ({ amount: Number(installment.amount), dueDate: installment.dueDate })),
    }
  }, [schedule, scheduleQuery.data])

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("cotisations.payment.title")} size="sm">
      {resolvedSchedule ? (
        // Keyed on the balance so a refetched schedule (e.g. a payment recorded elsewhere)
        // re-derives the pre-selected échéance instead of keeping a stale one.
        <PaymentForm
          key={`${cotisationId}-${resolvedSchedule.amountPaid}`}
          cotisationId={cotisationId}
          schedule={resolvedSchedule}
          onOpenChange={onOpenChange}
        />
      ) : scheduleQuery.isError ? (
        <p className="text-sm text-muted-foreground">{t("common.error")}</p>
      ) : (
        <div className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}
    </Modal>
  )
}

// Mounted only once the échéancier is known, so the pre-filled amount is right from the first
// render instead of flipping from "whole balance" to "next échéance" once the fetch lands.
function PaymentForm({ cotisationId, schedule, onOpenChange }: {
  cotisationId: string
  schedule:     CotisationPaymentScheduleInput
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations()
  const remaining = Math.max(0, schedule.amount - schedule.amountPaid)

  // Échéances still owed, each with what has to be paid now to settle it — payments cover
  // them in order (see installmentBalances), so settling the third one means paying the
  // second first. Capped at the balance in case the échéances don't add up to the total.
  const balances = useMemo(
    () => installmentBalances(schedule.installments, schedule.amountPaid).map(installment => ({
      ...installment,
      amountToClear: Math.min(installment.amountToClear, remaining),
    })),
    [schedule.installments, schedule.amountPaid, remaining],
  )
  const unpaidBalances = balances.filter(installment => !installment.covered && installment.amountToClear > EPSILON)
  const nextUnpaid = unpaidBalances[0]
  const showsInstallmentChoice = !!nextUnpaid

  const [choice, setChoice] = useState<string>(nextUnpaid ? String(nextUnpaid.position) : CUSTOM_CHOICE)
  const [amount, setAmount] = useState(nextUnpaid ? nextUnpaid.amountToClear : remaining)
  const [method, setMethod] = useState<Method>("CB")
  const [paidAt, setPaidAt] = useState(new Date().toISOString().split("T")[0])
  const [note, setNote]     = useState("")
  const mutation = useAddCotisationPayment(cotisationId)

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  function selectInstallment(position: number, amountToClear: number) {
    setChoice(String(position))
    setAmount(amountToClear)
  }

  // Typing a figure by hand no longer matches any échéance — reflect that in the choice
  // rather than leaving an échéance ticked next to an amount that doesn't settle it.
  function handleAmountChange(nextAmount: number) {
    setAmount(nextAmount)
    setChoice(CUSTOM_CHOICE)
  }

  async function handleSubmit() {
    if (amount <= 0) {
      toast.error(t("cotisations.payment.toasts.amountMustBePositive"))
      return
    }
    if (amount > remaining + EPSILON) {
      toast.error(t("cotisations.payment.toasts.amountExceedsBalance", { amount: formatEuros(remaining) }))
      return
    }
    try {
      await mutation.mutateAsync({ amount, method, paidAt, note })
      toast.success(t("cotisations.payment.toasts.recorded"))
      onOpenChange(false)
      setNote("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"))
    }
  }

  return (
    <div className="space-y-4">
      {showsInstallmentChoice && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm leading-none font-medium">{t("cotisations.payment.installmentChoice")}</legend>
          <div className="space-y-1.5 text-sm">
            {balances.map(installment => {
              const dueDate = new Date(installment.dueDate)
              const dueLabel = format(dueDate, "d MMM yyyy", { locale: fr })
              if (installment.covered || installment.amountToClear <= EPSILON) {
                return (
                  <p key={installment.position} className="pl-6 text-muted-foreground">
                    {t("cotisations.payment.installmentPaid", { position: installment.position })}
                  </p>
                )
              }
              const isNext = installment.position === nextUnpaid.position
              const isLate = dueDate < todayStart
              const isPartlyPaid = installment.remainingAmount < installment.amount - EPSILON
              return (
                <label key={installment.position} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name={`installment-choice-${cotisationId}`}
                    className="size-4 shrink-0 cursor-pointer accent-primary"
                    checked={choice === String(installment.position)}
                    onChange={() => selectInstallment(installment.position, installment.amountToClear)}
                  />
                  <span>
                    {isNext
                      ? t("cotisations.payment.installmentNext", { position: installment.position })
                      : t("cotisations.payment.installmentThrough", { position: installment.position })}
                    {" — "}
                    <span className={cn(isLate ? "text-destructive" : "text-muted-foreground")}>
                      {dueLabel}{isLate && t("cotisations.payment.lateSuffix")}
                    </span>
                    {" — "}
                    <span className="tabular-nums font-medium">{formatEuros(installment.amountToClear)}</span>
                    {isNext && isPartlyPaid && (
                      <span className="text-muted-foreground">
                        {" "}{t("cotisations.payment.installmentPartlyPaid", { amount: formatEuros(installment.amount) })}
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                name={`installment-choice-${cotisationId}`}
                className="size-4 shrink-0 cursor-pointer accent-primary"
                checked={choice === CUSTOM_CHOICE}
                onChange={() => setChoice(CUSTOM_CHOICE)}
              />
              <span>{t("cotisations.payment.customAmount")}</span>
            </label>
          </div>
          {unpaidBalances.length > 1 && (
            <p className="text-xs text-muted-foreground">{t("cotisations.payment.installmentsInOrder")}</p>
          )}
        </fieldset>
      )}
      <div className="space-y-1">
        <CurrencyField label={t("cotisations.payment.amount")} required value={amount} onChange={handleAmountChange} />
        <p className="text-xs text-muted-foreground">{t("cotisations.payment.remainingBalance", { amount: formatEuros(remaining) })}</p>
      </div>
      <SelectField label={t("cotisations.payment.method")} required options={methodOptions} value={method} onValueChange={(value) => setMethod(value as Method)} />
      <DateField label={t("cotisations.payment.date")} value={paidAt} onChange={setPaidAt} />
      <FormField label={t("cotisations.payment.note")} placeholder={t("cotisations.payment.notePlaceholder")} value={note} onChange={event => setNote(event.target.value)} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
          {t("common.cancel")}
        </Button>
        <Button type="button" onClick={handleSubmit} loading={mutation.isPending}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  )
}
