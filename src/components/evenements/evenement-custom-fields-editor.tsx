"use client"

import { useEffect, useImperativeHandle, useState, type Ref } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { useEvenementCustomFields, useSaveEvenementCustomFields, type EvenementCustomFieldDraft, type EvenementCustomFieldType } from "@/hooks/use-evenements"

type Props = {
  evenementId: string
  // Reported up so the wizard page can warn before navigating away — see the guard in
  // src/app/dashboard/evenements/[id]/page.tsx.
  onDirtyChange?: (dirty: boolean) => void
  ref?: Ref<EvenementCustomFieldsEditorHandle>
}

// Lets the page trigger this editor's save from "Enregistrer et quitter". Resolves to false
// when validation or the request failed — the toast has already been shown by then.
export type EvenementCustomFieldsEditorHandle = { save: () => Promise<boolean> }

const CHOICE_TYPES: EvenementCustomFieldType[] = ["SELECT", "RADIO", "CHECKBOX_MULTI"]

let nextTempId = 0

// Mirrors the handleSave() payload — see the same helper in membership-form-fields-editor.tsx.
function fieldsSignature(rows: EvenementCustomFieldDraft[]): string {
  return JSON.stringify(rows.map(f => [f.type, f.label, f.required, f.options ?? null]))
}

export function EvenementCustomFieldsEditor({ evenementId, onDirtyChange, ref }: Props) {
  const t = useTranslations("evenements.customFields")
  const tCommon = useTranslations("common")
  const { data, isLoading } = useEvenementCustomFields(evenementId)
  const saveMutation = useSaveEvenementCustomFields(evenementId)

  const [fields, setFields] = useState<(EvenementCustomFieldDraft & { key: string })[]>([])

  useEffect(() => {
    // Normalisé une seule fois ici, à la frontière avec le serveur — tout le reste du fichier
    // peut ensuite écrire `f.options ?? []` en confiance. Une valeur JSON malformée (édition
    // manuelle en DB, bug ailleurs) ne serait sinon jamais un tableau, et `.map`/`.filter`
    // planteraient au lieu de simplement traiter le champ comme "sans options".
    if (data) setFields(data.map(f => ({ ...f, key: f.id, options: Array.isArray(f.options) ? f.options : null })))
  }, [data])

  const isDirty = fieldsSignature(fields) !== fieldsSignature(data ?? [])
  useEffect(() => { onDirtyChange?.(isDirty) }, [isDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  useImperativeHandle(ref, () => ({ save: handleSave }))

  function addField() {
    setFields(prev => [...prev, { key: `new-${nextTempId++}`, type: "TEXT", label: "", required: false, options: null }])
  }

  function updateField(key: string, patch: Partial<EvenementCustomFieldDraft>) {
    setFields(prev => prev.map(f => f.key === key ? { ...f, ...patch } : f))
  }

  // Switching away from a choice type drops its options (nothing reads them anymore);
  // switching into one seeds 2 empty rows, same starting point as question-builder.tsx's
  // own SINGLE_CHOICE/MULTIPLE_CHOICE seed.
  function updateFieldType(key: string, type: EvenementCustomFieldType) {
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

  async function handleSave(): Promise<boolean> {
    if (fields.some(f => !f.label.trim())) {
      toast.error(t("labelRequiredError"))
      return false
    }
    if (fields.some(f => CHOICE_TYPES.includes(f.type) && (f.options ?? []).filter(o => o.trim()).length < 2)) {
      toast.error(t("optionsRequiredError"))
      return false
    }
    try {
      await saveMutation.mutateAsync(fields.map(f => ({
        type: f.type, label: f.label, required: f.required, id: f.id,
        options: CHOICE_TYPES.includes(f.type) ? (f.options ?? []).map(o => o.trim()).filter(Boolean) : null,
      })))
      toast.success(t("saved"))
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
      return false
    }
  }

  const typeOptions = [
    { value: "TEXT",           label: t("typeText") },
    { value: "LONG_TEXT",      label: t("typeLongText") },
    { value: "NUMBER",         label: t("typeNumber") },
    { value: "DATE",           label: t("typeDate") },
    { value: "BOOLEAN",        label: t("typeBoolean") },
    { value: "SELECT",         label: t("typeSelect") },
    { value: "RADIO",          label: t("typeRadio") },
    { value: "CHECKBOX_MULTI", label: t("typeCheckboxMulti") },
    { value: "FILE",           label: t("typeFile") },
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
                <div className="w-44">
                  <SelectField
                    label={t("fieldType")}
                    options={typeOptions}
                    value={field.type}
                    onValueChange={v => updateFieldType(field.key, v as EvenementCustomFieldType)}
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
        <Button type="button" size="sm" disabled={!isDirty} onClick={handleSave} loading={saveMutation.isPending}>
          {tCommon("save")}
        </Button>
      </div>
    </div>
  )
}
