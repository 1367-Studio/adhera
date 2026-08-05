"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { useEvenementCustomFields, useSaveEvenementCustomFields, type EvenementCustomFieldDraft } from "@/hooks/use-evenements"

type Props = {
  evenementId: string
  onClose:     () => void
}

let nextTempId = 0

export function EvenementCustomFieldsEditor({ evenementId, onClose }: Props) {
  const t = useTranslations("evenements.customFields")
  const tCommon = useTranslations("common")
  const { data, isLoading } = useEvenementCustomFields(evenementId)
  const saveMutation = useSaveEvenementCustomFields(evenementId)

  const [fields, setFields] = useState<(EvenementCustomFieldDraft & { key: string })[]>([])

  useEffect(() => {
    if (data) setFields(data.map(f => ({ ...f, key: f.id })))
  }, [data])

  function addField() {
    setFields(prev => [...prev, { key: `new-${nextTempId++}`, type: "TEXT", label: "", required: false }])
  }

  function updateField(key: string, patch: Partial<EvenementCustomFieldDraft>) {
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
      onClose()
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
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("description")}</p>

      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noFields")}</p>
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

      <Button type="button" variant="outline" onClick={addField}>
        <PlusIcon className="mr-1.5 size-4" />
        {t("addField")}
      </Button>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={saveMutation.isPending}>
          {tCommon("cancel")}
        </Button>
        <Button type="button" onClick={handleSave} loading={saveMutation.isPending}>
          {tCommon("save")}
        </Button>
      </div>
    </div>
  )
}
