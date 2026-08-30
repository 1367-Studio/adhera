"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"

type MembershipFormFieldDraft = { id?: string; type: "TEXT" | "NUMBER"; label: string; required: boolean }
type MembershipFormField      = MembershipFormFieldDraft & { id: string }

let nextTempId = 0

// Mirrors the handleSave() payload — see the same helper in membership-tiers-editor.tsx.
function fieldsSignature(rows: MembershipFormFieldDraft[]): string {
  return JSON.stringify(rows.map(f => [f.type, f.label, f.required]))
}

export function MembershipFormFieldsEditor({ formId, onDirtyChange }: {
  formId: string
  onDirtyChange?: (dirty: boolean) => void
}) {
  const t       = useTranslations("membershipForms.detail.steps.fields")
  const tCommon = useTranslations("common")
  const qc      = useQueryClient()

  const { data, isLoading } = useQuery<MembershipFormField[]>({
    queryKey: ["membership-form", formId, "custom-fields"],
    queryFn:  () => fetch(`/api/membership-forms/${formId}/custom-fields`).then(r => r.json()),
  })

  const saveMutation = useMutation({
    mutationFn: async (fields: MembershipFormFieldDraft[]) => {
      const res = await fetch(`/api/membership-forms/${formId}/custom-fields`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(fields),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? tCommon("error"))
      return res.json() as Promise<MembershipFormField[]>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["membership-form", formId, "custom-fields"] }),
  })

  const [fields, setFields] = useState<(MembershipFormFieldDraft & { key: string })[]>([])

  useEffect(() => { if (data) setFields(data.map(f => ({ ...f, key: f.id }))) }, [data])

  const isDirty = fieldsSignature(fields) !== fieldsSignature(data ?? [])
  useEffect(() => { onDirtyChange?.(isDirty) }, [isDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  function addField() {
    setFields(prev => [...prev, { key: `new-${nextTempId++}`, type: "TEXT", label: "", required: false }])
  }
  function updateField(key: string, patch: Partial<MembershipFormFieldDraft>) {
    setFields(prev => prev.map(f => f.key === key ? { ...f, ...patch } : f))
  }
  function removeField(key: string) {
    setFields(prev => prev.filter(f => f.key !== key))
  }

  async function handleSave() {
    if (fields.some(f => !f.label.trim())) {
      toast.error(t("labelRequiredError"))
      return
    }
    try {
      await saveMutation.mutateAsync(fields.map(f => ({ type: f.type, label: f.label, required: f.required, id: f.id })))
      toast.success(t("saved"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  const typeOptions = [
    { value: "TEXT",   label: t("typeText") },
    { value: "NUMBER", label: t("typeNumber") },
  ]

  if (isLoading) return <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{t("customFieldsTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("customFieldsHint")}</p>
      </div>

      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noCustomFields")}</p>
      )}

      <div className="space-y-3">
        {fields.map(field => (
          <div key={field.key} className="flex items-start gap-2 rounded-md border border-input p-3">
            <div className="flex-1 space-y-2">
              <FormField
                label={t("fieldLabel")}
                placeholder={t("fieldLabelPlaceholder")}
                value={field.label}
                onChange={e => updateField(field.key, { label: e.target.value })}
              />
              <div className="flex items-end gap-3">
                <div className="w-40">
                  <SelectField
                    label={t("fieldType")}
                    options={typeOptions}
                    value={field.type}
                    onValueChange={v => updateField(field.key, { type: v as "TEXT" | "NUMBER" })}
                  />
                </div>
                <div className="pb-2.5">
                  <CheckboxField
                    label={t("fieldRequired")}
                    checked={field.required}
                    onChange={e => updateField(field.key, { required: e.target.checked })}
                  />
                </div>
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeField(field.key)} aria-label={t("removeField")}>
              <TrashIcon className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="outline" size="sm" onClick={addField}>
          <PlusIcon className="mr-1.5 size-4" />
          {t("addField")}
        </Button>
        <Button type="button" size="sm" onClick={handleSave} loading={saveMutation.isPending}>
          {t("saveFields")}
        </Button>
      </div>
    </div>
  )
}
