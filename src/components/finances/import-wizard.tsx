"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"
import Link from "next/link"
import * as XLSX from "xlsx"
import { UploadIcon, ChevronRightIcon, CheckCircle2Icon, FileIcon } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useBankAccounts } from "@/hooks/use-bank-accounts"
import { cn } from "@/lib/utils"
type Step = 1 | 2 | 3 | 4

type ParsedRow = {
  transactionDate: string
  label:           string
  amount:          number
  type:            "CREDIT" | "DEBIT"
  balanceAfter?:   number
  externalId:      string
}

type ColumnMapping = {
  bankAccountId: string
  dateColumn:    string
  labelColumn:   string
  valueMode:     "single" | "split"
  amountColumn:  string
  debitColumn:   string
  creditColumn:  string
  balanceColumn: string
}

type ImportResult = { imported: number; duplicates: number; errors: number; toReconcile: number }

function makeExternalId(bankAccountId: string, row: Omit<ParsedRow, "externalId">): string {
  const raw = `${bankAccountId}|${row.transactionDate}|${row.label}|${row.amount}|${row.type}`
  // FNV-1a 32-bit — deterministic, collision-resistant enough for dedup
  let h = 0x811c9dc5
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, "0") + raw.length.toString(36)
}

function parseDate(val: unknown): string {
  if (!val) return ""
  if (typeof val === "number") {
    const date = XLSX.SSF.parse_date_code(val)
    if (date) return `${date.y}-${String(date.m).padStart(2,"0")}-${String(date.d).padStart(2,"0")}`
  }
  const s = String(val).trim()
  const parts = s.split(/[\/\-\.]/)
  if (parts.length === 3) {
    const [a, b, c] = parts
    if (c?.length === 4) return `${c}-${b.padStart(2,"0")}-${a.padStart(2,"0")}`
    if (a?.length === 4) return `${a}-${b.padStart(2,"0")}-${c.padStart(2,"0")}`
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? s : d.toISOString().split("T")[0]
}

function parseAmount(val: unknown): number {
  if (!val && val !== 0) return 0
  if (typeof val === "number") return val
  return parseFloat(String(val).replace(/\s/g, "").replace(",", ".")) || 0
}

function normalizeHeader(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[àáâãäå]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[ìíîï]/g, "i")
    .replace(/[òóôõö]/g, "o")
    .replace(/[ùúûü]/g, "u")
    .replace(/ç/g, "c")
}

const COLUMN_ALIASES: Record<"date" | "label" | "amount" | "debit" | "credit" | "balance", string[]> = {
  date:    ["date", "date operation", "date de l operation", "date valeur", "transaction date", "operation date"],
  label:   ["libelle", "description", "label", "intitule", "detail", "communication", "nature de l operation"],
  amount:  ["montant", "amount", "valeur"],
  debit:   ["debit", "sortie", "retrait"],
  credit:  ["credit", "entree", "depot"],
  balance: ["solde", "balance", "nouveau solde", "solde apres operation"],
}

function guessColumn(columns: string[], aliases: string[]): string {
  const normalized = columns.map(c => ({ original: c, normalized: normalizeHeader(c) }))
  const exact = normalized.find(c => aliases.includes(c.normalized))
  if (exact) return exact.original
  const partial = normalized.find(c => aliases.some(a => new RegExp(`\\b${a}\\b`).test(c.normalized)))
  return partial?.original ?? ""
}

function guessMapping(columns: string[]): Partial<ColumnMapping> {
  // Each column can only be claimed by one role — prevents e.g. a single
  // "Débit/Crédit" column from matching both aliases and forcing split mode.
  const available = [...columns]
  const claim = (aliases: string[]) => {
    const col = guessColumn(available, aliases)
    if (col) available.splice(available.indexOf(col), 1)
    return col
  }

  const dateColumn    = claim(COLUMN_ALIASES.date)
  const labelColumn   = claim(COLUMN_ALIASES.label)
  const debitColumn   = claim(COLUMN_ALIASES.debit)
  const creditColumn  = claim(COLUMN_ALIASES.credit)
  const amountColumn  = claim(COLUMN_ALIASES.amount)
  const balanceColumn = claim(COLUMN_ALIASES.balance)

  const valueMode: "single" | "split" = debitColumn && creditColumn ? "split" : "single"

  return {
    dateColumn,
    labelColumn,
    valueMode,
    amountColumn: valueMode === "single" ? amountColumn : "",
    debitColumn:  valueMode === "split" ? debitColumn  : "",
    creditColumn: valueMode === "split" ? creditColumn : "",
    balanceColumn,
  }
}

function AutoBadge() {
  return <span className="ml-1.5 rounded bg-blue-100 px-1.5 py-0.5 align-middle text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">Détecté</span>
}

function RequiredLabel({ required = true, detected, children }: { required?: boolean; detected?: boolean; children: React.ReactNode }) {
  return (
    <label className="text-sm font-medium">
      {children}
      {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
      {detected && <AutoBadge />}
    </label>
  )
}

type ColOption = { value: string; label: string }

function ColumnField({
  label, required, detected, value, onChange, options, placeholder = "Sélectionner",
}: {
  label:    string
  required?: boolean
  detected?: boolean
  value:    string
  onChange: (v: string) => void
  options:  ColOption[]
  placeholder?: string
}) {
  return (
    <div>
      <RequiredLabel required={required} detected={detected}>{label}</RequiredLabel>
      <Select value={value} onValueChange={v => onChange(v ?? "")}>
        <SelectTrigger className="mt-1"><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>{options.map(o => <SelectItem key={o.value || "__none"} value={o.value || "__none"}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  )
}

export function ImportWizard() {
  const [step, setStep]           = useState<Step>(1)
  const [file, setFile]           = useState<File | null>(null)
  const [rawRows, setRawRows]     = useState<Record<string, unknown>[]>([])
  const [columns, setColumns]     = useState<string[]>([])
  const [mapping, setMapping]     = useState<ColumnMapping>({ bankAccountId: "", dateColumn: "", labelColumn: "", valueMode: "single", amountColumn: "", debitColumn: "", creditColumn: "", balanceColumn: "" })
  const [autoDetected, setAutoDetected] = useState<Set<keyof ColumnMapping>>(new Set())
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult]       = useState<ImportResult | null>(null)

  const { data: accounts = [] } = useBankAccounts()

  const handleFileSelect = useCallback((f: File) => {
    setFile(f)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer
        const workbook = XLSX.read(buffer, { type: "array", cellDates: false })
        const sheet    = workbook.Sheets[workbook.SheetNames[0]]
        const rows     = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })
        const headers = rows.length > 0 ? Object.keys(rows[0]) : []
        const guessed = guessMapping(headers)
        const detected = new Set<keyof ColumnMapping>()
        if (guessed.dateColumn)    detected.add("dateColumn")
        if (guessed.labelColumn)   detected.add("labelColumn")
        if (guessed.balanceColumn) detected.add("balanceColumn")
        if (guessed.amountColumn)                      { detected.add("amountColumn"); detected.add("valueMode") }
        if (guessed.debitColumn && guessed.creditColumn) { detected.add("debitColumn"); detected.add("creditColumn"); detected.add("valueMode") }
        setRawRows(rows)
        setColumns(headers)
        setMapping(m => ({ ...m, ...guessed }))
        setAutoDetected(detected)
        setStep(2)
      } catch {
        toast.error("Impossible de lire le fichier")
      }
    }
    reader.readAsArrayBuffer(f)
  }, [])

  const VALID_EXTENSIONS = [".csv", ".xlsx", ".xls"]
  function isValidFile(f: File): boolean {
    const name = f.name.toLowerCase()
    return VALID_EXTENSIONS.some(ext => name.endsWith(ext))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (!f) return
    if (!isValidFile(f)) {
      toast.error("Format non supporté. Utilisez un fichier CSV, XLSX ou XLS.")
      return
    }
    handleFileSelect(f)
  }

  function parseRows(): ParsedRow[] {
    const result: ParsedRow[] = []
    for (const row of rawRows) {
      const dateStr = parseDate(row[mapping.dateColumn])
      const label   = String(row[mapping.labelColumn] ?? "").trim()
      if (!dateStr || !label) continue

      let amount = 0
      let type: "CREDIT" | "DEBIT" = "CREDIT"

      if (mapping.valueMode === "single" && mapping.amountColumn) {
        const raw = parseAmount(row[mapping.amountColumn])
        amount = Math.abs(raw)
        type   = raw >= 0 ? "CREDIT" : "DEBIT"
      } else {
        const debit  = mapping.debitColumn  ? parseAmount(row[mapping.debitColumn])  : 0
        const credit = mapping.creditColumn ? parseAmount(row[mapping.creditColumn]) : 0
        if (credit > 0)     { amount = credit; type = "CREDIT" }
        else if (debit > 0) { amount = debit;  type = "DEBIT" }
        else continue
      }

      if (amount === 0) continue

      const balanceAfter = mapping.balanceColumn ? parseAmount(row[mapping.balanceColumn]) || undefined : undefined
      const partial = { transactionDate: dateStr, label, amount, type, balanceAfter }
      result.push({ ...partial, externalId: makeExternalId(mapping.bankAccountId, partial) } as ParsedRow)
    }
    return result
  }

  function handlePreview() {
    if (!mapping.bankAccountId || !mapping.dateColumn || !mapping.labelColumn) {
      toast.error("Veuillez sélectionner le compte et les colonnes obligatoires")
      return
    }
    if (mapping.valueMode === "single" && !mapping.amountColumn) {
      toast.error("Veuillez sélectionner la colonne de montant")
      return
    }
    if (mapping.valueMode === "split" && (!mapping.debitColumn || !mapping.creditColumn)) {
      toast.error("Veuillez sélectionner les colonnes Débit et Crédit")
      return
    }
    const rows = parseRows()
    if (!rows.length) {
      toast.error("Aucune ligne valide détectée")
      return
    }
    setParsedRows(rows)
    setStep(3)
  }

  async function handleImport() {
    setImporting(true)
    try {
      const res = await fetch("/api/finances/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows, mapping }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? "Erreur d'importation")
      }
      const data = await res.json() as ImportResult
      setResult(data)
      setStep(4)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setStep(1); setFile(null); setRawRows([]); setColumns([]); setParsedRows([]); setResult(null)
    setMapping({ bankAccountId: "", dateColumn: "", labelColumn: "", valueMode: "single", amountColumn: "", debitColumn: "", creditColumn: "", balanceColumn: "" })
    setAutoDetected(new Set())
  }

  function updateMapping<K extends keyof ColumnMapping>(key: K, value: ColumnMapping[K]) {
    setMapping(m => ({ ...m, [key]: value }))
    setAutoDetected(prev => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const colOptions = [
    { value: "", label: "—" },
    ...columns.map(c => ({ value: c, label: c })),
  ]

  const typedAccounts = accounts as { id: string; accountName: string; bankName: string }[]
  const selectedAccount = typedAccounts.find(a => a.id === mapping.bankAccountId)

  const credits = parsedRows.filter(r => r.type === "CREDIT").length
  const debits  = parsedRows.filter(r => r.type === "DEBIT").length

  return (
    <div className="space-y-4">
      <PageHeader title="Importer un relevé bancaire" description="Importez un fichier CSV ou Excel depuis votre banque." />

      {/* Steps indicator */}
      <div className="flex items-center gap-1 text-sm">
        {[
          { n: 1, label: "Upload" },
          { n: 2, label: "Mapping" },
          { n: 3, label: "Aperçu" },
          { n: 4, label: "Résultat" },
        ].map((s, i) => (
          <div key={s.n} className="flex items-center gap-1">
            {i > 0 && <ChevronRightIcon className="size-4 text-muted-foreground" />}
            <span className={cn("font-medium", step === s.n ? "text-foreground" : step > s.n ? "text-green-600 dark:text-green-400" : "text-muted-foreground")}>
              {step > s.n ? <CheckCircle2Icon className="inline size-4" /> : `${s.n}.`} {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          className="rounded-xl border-2 border-dashed border-muted-foreground/30 p-12 text-center cursor-pointer hover:border-muted-foreground/60 transition-colors"
          onClick={() => document.getElementById("file-input")?.click()}
        >
          <input
            id="file-input"
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f) }}
          />
          <UploadIcon className="size-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">Glissez-déposez votre relevé ici</p>
          <p className="text-sm text-muted-foreground mt-1">CSV ou Excel (.xlsx, .xls) — export depuis votre banque</p>
        </div>
      )}

      {/* Step 2: Column mapping */}
      {step === 2 && (
        <div className="rounded-xl border bg-card p-6 space-y-5">
          <div>
            <p className="text-sm font-medium mb-1 text-muted-foreground">Fichier sélectionné</p>
            <div className="flex items-center gap-2 text-sm"><FileIcon className="size-4" />{file?.name} — {rawRows.length} lignes détectées</div>
          </div>

          {(accounts as { id: string }[]).length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm text-muted-foreground">Aucun compte bancaire configuré.</p>
              <Link href="/dashboard/finances/comptes" className="text-sm font-medium underline mt-1 inline-block">
                Créer un compte bancaire →
              </Link>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <RequiredLabel>Compte bancaire</RequiredLabel>
                  <Select value={mapping.bankAccountId} onValueChange={v => setMapping(m => ({ ...m, bankAccountId: v ?? "" }))}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Sélectionner un compte">
                        {selectedAccount ? `${selectedAccount.accountName} — ${selectedAccount.bankName}` : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {typedAccounts.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.accountName} — {a.bankName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <ColumnField
                  label="Colonne de date"
                  detected={autoDetected.has("dateColumn")}
                  value={mapping.dateColumn}
                  onChange={v => updateMapping("dateColumn", v)}
                  options={colOptions}
                />

                <ColumnField
                  label="Colonne de libellé"
                  detected={autoDetected.has("labelColumn")}
                  value={mapping.labelColumn}
                  onChange={v => updateMapping("labelColumn", v)}
                  options={colOptions}
                />

                <div>
                  <RequiredLabel detected={autoDetected.has("valueMode")}>Format des montants</RequiredLabel>
                  <Select value={mapping.valueMode} onValueChange={v => updateMapping("valueMode", v as "single" | "split")}>
                    <SelectTrigger className="mt-1">
                      <SelectValue>
                        {mapping.valueMode === "split" ? "Deux colonnes (Débit / Crédit)" : "Colonne unique (±montant)"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="single">Colonne unique (positif = crédit, négatif = débit)</SelectItem>
                      <SelectItem value="split">Deux colonnes séparées (Débit / Crédit)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {mapping.valueMode === "single" && (
                  <ColumnField
                    label="Colonne montant"
                    detected={autoDetected.has("amountColumn")}
                    value={mapping.amountColumn}
                    onChange={v => updateMapping("amountColumn", v)}
                    options={colOptions}
                  />
                )}

                {mapping.valueMode === "split" && (
                  <>
                    <ColumnField
                      label="Colonne débit"
                      detected={autoDetected.has("debitColumn")}
                      value={mapping.debitColumn}
                      onChange={v => updateMapping("debitColumn", v)}
                      options={colOptions}
                    />
                    <ColumnField
                      label="Colonne crédit"
                      detected={autoDetected.has("creditColumn")}
                      value={mapping.creditColumn}
                      onChange={v => updateMapping("creditColumn", v)}
                      options={colOptions}
                    />
                  </>
                )}

                <ColumnField
                  label="Colonne solde (optionnel)"
                  required={false}
                  detected={autoDetected.has("balanceColumn")}
                  value={mapping.balanceColumn}
                  onChange={v => updateMapping("balanceColumn", v)}
                  options={colOptions}
                  placeholder="—"
                />
              </div>

              {/* Preview of first 3 rows */}
              {rawRows.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Aperçu des premières lignes du fichier</p>
                  <div className="overflow-x-auto rounded-lg border text-xs">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          {columns.map(c => <th key={c} className="px-3 py-2 text-left font-medium">{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {rawRows.slice(0, 3).map((row, i) => (
                          <tr key={i} className="border-b last:border-0">
                            {columns.map(c => <td key={c} className="px-3 py-2 text-muted-foreground">{String(row[c] ?? "")}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={reset}>Recommencer</Button>
            {(accounts as { id: string }[]).length > 0 && (
              <Button onClick={handlePreview}>Aperçu du résultat</Button>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Preview & confirm */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-card p-5">
            <h3 className="font-semibold mb-3">Résultat du parsing</h3>
            <div className="grid grid-cols-3 gap-4 text-center mb-4">
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-2xl font-bold">{parsedRows.length}</p>
                <p className="text-xs text-muted-foreground">Lignes valides</p>
              </div>
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-3">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{credits}</p>
                <p className="text-xs text-muted-foreground">Crédits</p>
              </div>
              <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-3">
                <p className="text-2xl font-bold text-destructive">{debits}</p>
                <p className="text-xs text-muted-foreground">Débits</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border text-xs">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Libellé</th>
                    <th className="px-3 py-2 text-right">Montant</th>
                    <th className="px-3 py-2 text-center">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 8).map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2 text-muted-foreground">{row.transactionDate}</td>
                      <td className="px-3 py-2 max-w-xs truncate">{row.label}</td>
                      <td className={`px-3 py-2 text-right font-mono font-medium ${row.type === "CREDIT" ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                        {row.type === "CREDIT" ? "+" : "−"}{row.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${row.type === "CREDIT" ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"}`}>
                          {row.type === "CREDIT" ? "Crédit" : "Débit"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsedRows.length > 8 && <p className="text-xs text-muted-foreground mt-2 text-center">… et {parsedRows.length - 8} ligne(s) supplémentaire(s)</p>}
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>Retour</Button>
            <Button onClick={handleImport} loading={importing}>Importer {parsedRows.length} transaction(s)</Button>
          </div>
        </div>
      )}

      {/* Step 4: Result */}
      {step === 4 && result && (
        <div className="rounded-xl border bg-card p-8 text-center space-y-4">
          <CheckCircle2Icon className="size-12 mx-auto text-green-600 dark:text-green-400" />
          <h3 className="text-xl font-bold">Importation réussie</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-lg mx-auto">
            <div>
              <p className="text-3xl font-bold">{result.imported}</p>
              <p className="text-xs text-muted-foreground">Importées</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-muted-foreground">{result.duplicates}</p>
              <p className="text-xs text-muted-foreground">Doublons ignorés</p>
            </div>
            {result.errors > 0 && (
              <div>
                <p className="text-3xl font-bold text-destructive">{result.errors}</p>
                <p className="text-xs text-muted-foreground">Erreurs</p>
              </div>
            )}
            <div>
              <p className="text-3xl font-bold text-orange-600">{result.toReconcile}</p>
              <p className="text-xs text-muted-foreground">À concilier</p>
            </div>
          </div>
          <div className="flex justify-center gap-3 pt-2">
            <Button variant="outline" onClick={reset}>Importer un autre fichier</Button>
            <Button onClick={() => window.location.href = "/dashboard/finances/conciliation"}>Aller à la conciliation</Button>
          </div>
        </div>
      )}
    </div>
  )
}
