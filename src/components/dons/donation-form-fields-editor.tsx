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

type DonationFieldType = "TEXT" | "NUMBER" | "SELECT"
type DonationFormFieldDraft = { id?: string; type: DonationFieldType; label: string; required: boolean; options: string[] | null }
type DonationFormField      = DonationFormFieldDraft & { id: string }

const CHOICE_TYPES: DonationFieldType[] = ["SELECT"]

let nextTempId = 0

export function DonationFormFieldsEditor({ formId }: { formId: string }) {
  const t       = useTranslations("donationForms.detail.steps.fields")
  const tCommon = useTranslations("common")
  const qc      = useQueryClient()

  const { data, isLoading } = useQuery<DonationFormField[]>({
    queryKey: ["donation-form", formId, "custom-fields"],
    queryFn:  () => fetch(`/api/donation-forms/${formId}/custom-fields`).then(r => r.json()),
  })

  const saveMutation = useMutation({
    mutationFn: async (fields: DonationFormFieldDraft[]) => {
      const res = await fetch(`/api/donation-forms/${formId}/custom-fields`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(fields),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? tCommon("error"))
      return res.json() as Promise<DonationFormField[]>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["donation-form", formId, "custom-fields"] }),
  })

  const [fields, setFields] = useState<(DonationFormFieldDraft & { key: string })[]>([])

  useEffect(() => {
    // Normalisé une seule fois ici, à la frontière avec le serveur — voir la même note dans
    // evenement-custom-fields-editor.tsx.
    if (data) setFields(data.map(f => ({ ...f, key: f.id, options: Array.isArray(f.options) ? f.options : null })))
  }, [data])

  function addField() {
    setFields(prev => [...prev, { key: `new-${nextTempId++}`, type: "TEXT", label: "", required: false, options: null }])
  }
  function updateField(key: string, patch: Partial<DonationFormFieldDraft>) {
    setFields(prev => prev.map(f => f.key === key ? { ...f, ...patch } : f))
  }
  // Switching away from SELECT drops its options (nothing reads them anymore); switching into
  // it seeds 2 empty rows — same convention as evenement-custom-fields-editor.tsx.
  function updateFieldType(key: string, type: DonationFieldType) {
    setFields(prev => prev.map(f => f.key === key ? {
      ...f, type,
      options: CHOICE_TYPES.includes(type) ? (f.options ?? ["", ""]) : null,
    } : f))
  }
  function updateOption(key: string, i: number, value: string) {
    setFields(prev => prev.map(f => {
      if (f.key !== key) return f
      const options = [...(f.options ?? [])]
      options[i] = value
      return { ...f, options }
    }))
  }
  function addOption(key: string) {
    setFields(prev => prev.map(f => f.key === key ? { ...f, options: [...(f.options ?? []), ""] } : f))
  }
  function removeOption(key: string, i: number) {
    setFields(prev => prev.map(f => f.key === key ? { ...f, options: (f.options ?? []).filter((_, j) => j !== i) } : f))
  }
  function removeField(key: string) {
    setFields(prev => prev.filter(f => f.key !== key))
  }

  async function handleSave() {
    if (fields.some(f => !f.label.trim())) {
      toast.error(t("labelRequiredError"))
      return
    }
    if (fields.some(f => CHOICE_TYPES.includes(f.type) && (f.options ?? []).filter(o => o.trim()).length < 2)) {
      toast.error(t("optionsRequiredError"))
      return
    }
    if (fields.some(f => {
      if (!CHOICE_TYPES.includes(f.type)) return false
      const opts = (f.options ?? []).map(o => o.trim().toLowerCase()).filter(Boolean)
      return new Set(opts).size !== opts.length
    })) {
      toast.error(t("duplicateOptionsError"))
      return
    }
    try {
      await saveMutation.mutateAsync(fields.map(f => ({
        type: f.type, label: f.label, required: f.required, id: f.id,
        options: CHOICE_TYPES.includes(f.type) ? (f.options ?? []).map(o => o.trim()).filter(Boolean) : null,
      })))
      toast.success(t("saved"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  const typeOptions = [
    { value: "TEXT",   label: t("typeText") },
    { value: "NUMBER", label: t("typeNumber") },
    { value: "SELECT", label: t("typeSelect") },
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
                    onValueChange={v => updateFieldType(field.key, v as DonationFieldType)}
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
              {CHOICE_TYPES.includes(field.type) && (
                <div className="space-y-1.5 pl-1">
                  {(field.options ?? []).map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={opt}
                        placeholder={t("optionPlaceholder", { n: i + 1 })}
                        onChange={e => updateOption(field.key, i, e.target.value)}
                        className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        type="button"
                        disabled={(field.options ?? []).length <= 2}
                        onClick={() => removeOption(field.key, i)}
                        className="text-muted-foreground hover:text-destructive disabled:opacity-30"
                        aria-label={t("removeOption")}
                      >
                        <TrashIcon className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addOption(field.key)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <PlusIcon className="size-3" /> {t("addOption")}
                  </button>
                </div>
              )}
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
