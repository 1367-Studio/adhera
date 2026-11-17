"use client"

import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { reimbursementRequestSchema, type ReimbursementRequestInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { useBudgetProjects } from "@/hooks/use-budget"
import { useEvenementsPaginated } from "@/hooks/use-evenements"

interface ReimbursementFormProps {
  defaultValues?: Partial<ReimbursementRequestInput>
  onSubmit: (data: ReimbursementRequestInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
  // Locked once the request has been submitted at least once — only DRAFT/NEEDS_CORRECTION
  // can still edit the header (see PATCH /api/finances/reimbursements/[id]).
  locked?: boolean
}

export function ReimbursementForm({ defaultValues, onSubmit, onCancel, loading, locked }: ReimbursementFormProps) {
  const t = useTranslations()

  const { data: projects = [] } = useBudgetProjects(true)
  const projectOptions = [
    { value: "", label: t("reimbursements.form.noProject") },
    ...projects.map(p => ({ value: p.id, label: p.name })),
  ]

  // Ticket wording is "Evento ou projeto associado" — both links are independent and optional,
  // not an either/or. No dedicated "all events" endpoint exists (unlike budget projects), so
  // this reuses the paginated list at a generous page size, same posture as a plain dropdown.
  const { data: eventsPage } = useEvenementsPaginated(1, 100)
  const events = (eventsPage?.data ?? []) as { id: string; title: string }[]
  const eventOptions = [
    { value: "", label: t("reimbursements.form.noEvent") },
    ...events.map(e => ({ value: e.id, label: e.title })),
  ]

  const { register, control, handleSubmit, formState: { errors } } = useForm<ReimbursementRequestInput>({
    resolver: zodResolver(reimbursementRequestSchema),
    defaultValues: { subject: "", comment: "", projectId: "", eventId: "", ...defaultValues },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField
        label={t("reimbursements.form.subject")}
        placeholder={t("reimbursements.form.subjectPlaceholder")}
        required
        disabled={locked}
        error={errors.subject?.message}
        {...register("subject")}
      />

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="eventId"
          control={control}
          render={({ field }) => (
            <SelectField label={t("reimbursements.form.event")} options={eventOptions} disabled={locked} value={field.value ?? ""} onValueChange={field.onChange} />
          )}
        />
        <Controller
          name="projectId"
          control={control}
          render={({ field }) => (
            <SelectField label={t("reimbursements.form.project")} options={projectOptions} disabled={locked} value={field.value ?? ""} onValueChange={field.onChange} />
          )}
        />
      </div>

      <FormField
        label={t("reimbursements.form.comment")}
        placeholder={t("reimbursements.form.commentPlaceholder")}
        disabled={locked}
        error={errors.comment?.message}
        {...register("comment")}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>{t("common.cancel")}</Button>
        <Button type="submit" loading={loading}>{t("common.save")}</Button>
      </div>
    </form>
  )
}
