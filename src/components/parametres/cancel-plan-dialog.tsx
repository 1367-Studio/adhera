"use client"

import { useForm, Controller, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { SelectField } from "@/components/ui/select-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { apiErrorMessage } from "@/lib/api-error"

const CANCEL_REASONS = [
  "PRICE", "MISSING_FEATURES", "ASSOCIATION_INACTIVE", "SWITCHING_TOOL", "HARD_TO_USE", "OTHER",
] as const

type Translator = ReturnType<typeof useTranslations>

function buildSchema(t: Translator) {
  return z.object({
    reason:   z.enum(CANCEL_REASONS, { message: t("cancelPlanDialog.validation.reasonRequired") }),
    feedback: z.string().trim().max(1000).optional(),
  }).refine(
    (data) => data.reason !== "OTHER" || !!data.feedback?.length,
    { message: t("cancelPlanDialog.validation.feedbackRequired"), path: ["feedback"] },
  )
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>

interface CancelPlanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Self-service cancellation from TRIAL/ACTIVE — pairs with POST /api/billing/cancel-subscription,
// which schedules cancel_at_period_end instead of cancelling immediately (see that route for why).
export function CancelPlanDialog({ open, onOpenChange }: CancelPlanDialogProps) {
  const t       = useTranslations("parametres.billing")
  const tCommon = useTranslations("common")
  const qc      = useQueryClient()

  const reasonOptions = [
    { value: "PRICE",                label: t("cancelPlanDialog.reasons.price") },
    { value: "MISSING_FEATURES",     label: t("cancelPlanDialog.reasons.missingFeatures") },
    { value: "ASSOCIATION_INACTIVE", label: t("cancelPlanDialog.reasons.associationInactive") },
    { value: "SWITCHING_TOOL",       label: t("cancelPlanDialog.reasons.switchingTool") },
    { value: "HARD_TO_USE",          label: t("cancelPlanDialog.reasons.hardToUse") },
    { value: "OTHER",                label: t("cancelPlanDialog.reasons.other") },
  ]

  const { control, register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(buildSchema(t)),
  })
  const reason = useWatch({control, name: "reason"})

  const cancelMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const res = await fetch("/api/billing/cancel-subscription", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(values),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, tCommon("error")))
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing-status"] })
      toast.success(t("cancelPlanDialog.successToast"))
      reset()
      onOpenChange(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  const isPending = isSubmitting || cancelMutation.isPending

  return (
    <Modal
      open={open}
      onOpenChange={(next) => { if (!isPending) { reset(); onOpenChange(next) } }}
      title={t("cancelPlanDialog.title")}
      description={t("cancelPlanDialog.description")}
      size="sm"
      dismissable={!isPending}
    >
      <form onSubmit={handleSubmit((values) => cancelMutation.mutate(values))} className="space-y-4">
        <Controller
          name="reason"
          control={control}
          render={({ field }) => (
            <SelectField
              label={t("cancelPlanDialog.reasonLabel")}
              required
              options={reasonOptions}
              value={field.value}
              onValueChange={field.onChange}
              placeholder={t("cancelPlanDialog.reasonPlaceholder")}
              error={errors.reason?.message}
            />
          )}
        />

        <TextareaField
          label={t("cancelPlanDialog.feedbackLabel")}
          required={reason === "OTHER"}
          placeholder={t("cancelPlanDialog.feedbackPlaceholder")}
          error={errors.feedback?.message}
          rows={3}
          {...register("feedback")}
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" variant="destructive" loading={isPending}>
            {t("cancelPlanDialog.confirmLabel")}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
