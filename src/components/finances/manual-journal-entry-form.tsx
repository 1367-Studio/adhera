"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { DateField, todayValue } from "@/components/ui/date-field"
import { CurrencyInput } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"
import type { ChartAccountOption, ManualJournalEntryInput } from "@/hooks/use-journal-manual"

interface Line {
  chartAccountId: string
  debit:  number
  credit: number
}

function emptyLine(): Line {
  return { chartAccountId: "", debit: 0, credit: 0 }
}

interface ManualJournalEntryFormProps {
  exerciceOptions: { value: string; label: string }[]
  chartAccounts:   ChartAccountOption[]
  onSubmit:        (data: ManualJournalEntryInput) => Promise<void>
  onCancel:        () => void
  loading?:        boolean
}

export function ManualJournalEntryForm({ exerciceOptions, chartAccounts, onSubmit, onCancel, loading }: ManualJournalEntryFormProps) {
  const t = useTranslations("finances.journalManual")
  const [exerciceId, setExerciceId] = useState(exerciceOptions[0]?.value ?? "")
  const [date, setDate]             = useState(todayValue())
  const [label, setLabel]           = useState("")
  const [lines, setLines]           = useState<Line[]>([emptyLine(), emptyLine()])
  const [error, setError]           = useState<string | null>(null)

  const accountOptions = chartAccounts.map(a => ({ value: a.id, label: `${a.code} — ${a.label}` }))
  const totalDebit  = lines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
  const balanced    = totalDebit === totalCredit && totalDebit > 0
  const hasEmptyAccount = lines.some(l => !l.chartAccountId)

  function updateLine(index: number, patch: Partial<Line>) {
    setLines(prev => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)))
  }

  function addLine() {
    setLines(prev => [...prev, emptyLine()])
  }

  function removeLine(index: number) {
    setLines(prev => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!balanced) {
      setError(t("mustBalance"))
      return
    }
    if (hasEmptyAccount) {
      setError(t("missingAccount"))
      return
    }
    await onSubmit({
      exerciceId, date, label,
      lines: lines
        .filter(l => l.debit > 0 || l.credit > 0)
        .map(l => ({ chartAccountId: l.chartAccountId, debit: l.debit || undefined, credit: l.credit || undefined })),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <SelectField
          label={t("exercice")}
          required
          options={exerciceOptions}
          value={exerciceId}
          onValueChange={setExerciceId}
        />
        <DateField label={t("date")} required value={date} onChange={setDate} />
      </div>

      <FormField
        label={t("label")}
        required
        placeholder={t("labelPlaceholder")}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />

      <div className="space-y-2">
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="py-2 pl-3 pr-2 text-left font-medium text-muted-foreground">{t("account")}</th>
                <th className="py-2 px-2 text-right font-medium text-muted-foreground w-28">{t("debit")}</th>
                <th className="py-2 px-2 text-right font-medium text-muted-foreground w-28">{t("credit")}</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1.5 pl-3 pr-2">
                    <SelectField
                      id={`manual-line-account-${i}`}
                      label={t("account")}
                      options={accountOptions}
                      value={line.chartAccountId}
                      onValueChange={(v) => updateLine(i, { chartAccountId: v })}
                      placeholder={t("accountPlaceholder")}
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <CurrencyInput
                      value={line.debit}
                      onChange={(v) => updateLine(i, { debit: v, credit: v > 0 ? 0 : line.credit })}
                    />
                  </td>
                  <td className="py-1.5 px-2">
                    <CurrencyInput
                      value={line.credit}
                      onChange={(v) => updateLine(i, { credit: v, debit: v > 0 ? 0 : line.debit })}
                    />
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <Button
                      type="button" variant="ghost" size="icon-sm"
                      onClick={() => lines.length > 2 && removeLine(i)}
                      disabled={lines.length <= 2}
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addLine}>
          <PlusIcon className="mr-1.5 size-4" />
          {t("addLine")}
        </Button>
      </div>

      <div className="flex items-center justify-between text-sm rounded-lg bg-muted/30 px-3 py-2">
        <span className="text-muted-foreground">{t("totals")}</span>
        <span className={`tabular-nums font-medium ${balanced ? "" : "text-destructive"}`}>
          {totalDebit.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
          {" / "}
          {totalCredit.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
        </span>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>{t("cancel")}</Button>
        <Button type="submit" loading={loading} disabled={!balanced || hasEmptyAccount || !label || !exerciceId}>
          {t("submit")}
        </Button>
      </div>
    </form>
  )
}
