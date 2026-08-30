"use client"

import { useState, useCallback, Fragment } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import * as XLSX from "xlsx"
import { UploadSimpleIcon, CaretRightIcon, CheckCircleIcon, FileIcon } from "@phosphor-icons/react/dist/ssr"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { cn } from "@/lib/utils"
import { BASE_PATH } from "@/lib/env"
import { registerPendingBulkSend } from "@/hooks/use-bulk-send-listener"

type Step = 1 | 2 | 3 | 4

type FieldId =
  | "externalId"
  | "firstName" | "lastName" | "email" | "phoneMobile" | "phoneFixe"
  | "sexe" | "birthDate" | "civilite"
  | "addressStreet" | "addressComplement" | "postalCode" | "city" | "region" | "department" | "country"
  | "amount" | "periodStart" | "periodEnd" | "operationDate" | "paymentStatus" | "paymentMethod" | "collecte"

type ColumnMapping = Record<FieldId, string>

type ParsedRow = {
  firstName: string
  lastName:  string
  externalId?: string
  email?:    string
  phone?:    string
  address?:  string
  sexe?:     "HOMME" | "FEMME"
  civilite?: "MME" | "MLLE" | "M"
  birthDate?: string
  year?:        number
  amount?:      number
  periodStart?: string
  periodEnd?:   string
  paymentReceived?: boolean
  paidAt?:      string
  method?:      "CB" | "CHQ" | "ESP" | "En ligne" | "Autre"
  note?:        string
  _error?: "missingName"
}

// The real result (created/matched/errors, name-only-match sample to verify) no longer comes
// back synchronously — the import now runs in the background (Inngest, src/inngest/membres-
// import.ts). This response just confirms the job was queued; registerPendingBulkSend +
// useBulkSendListener (mounted in AppSidebar) deliver the real toast once it finishes, and a
// persistent in-app notification carries the full detail (including the name-only-match
// sample), since a toast alone can't hold that and disappears if the admin has moved on.
type QueuedImport = { jobId: string; totalRows: number; schemaErrors: number }

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
    .replace(/['’]/g, "")
}

const FIELD_ALIASES: Record<FieldId, string[]> = {
  externalId:        ["id contact", "id du contact", "contact id"],
  firstName:         ["prenom", "first name", "firstname"],
  lastName:          ["nom", "last name", "lastname"],
  email:             ["email", "e-mail", "mail"],
  phoneMobile:       ["telephone mobile", "mobile"],
  phoneFixe:         ["telephone fixe", "telephone", "tel"],
  sexe:              ["sexe", "sex"],
  birthDate:         ["date de naissance", "anniversaire", "birthday"],
  civilite:          ["civilite", "titre"],
  addressStreet:     ["adresse postale", "adresse"],
  addressComplement: ["complement dadresse", "complement"],
  postalCode:        ["code postal", "cp"],
  city:              ["ville"],
  region:            ["region"],
  department:        ["departement"],
  country:           ["pays"],
  amount:            ["montant de loperation", "montant"],
  periodStart:       ["date de debut dadhesion", "date de debut"],
  periodEnd:         ["date de fin dadhesion", "date de fin"],
  operationDate:     ["date de loperation", "date operation"],
  // "statut" alone is deliberately not an alias here — it's too generic and false-matched
  // a "Statut adhérent" column (membership status, not payment status) on the AssoConnect
  // "Contacts" export, which has no actual payment data at all.
  paymentStatus:     ["statut du paiement"],
  paymentMethod:     ["moyen de paiement utilise", "moyen de paiement"],
  collecte:          ["nom de la collecte dadhesion associee", "collecte"],
}

// Order the mapping-review table renders in — grouped for scannability instead of one flat
// alphabetical list (see comment in membre-import-wizard plan: a 21-row form grid would be
// noisy, a grouped table reads better).
const FIELD_GROUPS: { label: string; fields: { id: FieldId; required?: boolean }[] }[] = [
  {
    label: "member",
    fields: [
      { id: "externalId" },
      { id: "firstName", required: true },
      { id: "lastName", required: true },
      { id: "email" },
      { id: "phoneMobile" },
      { id: "phoneFixe" },
      { id: "sexe" },
      { id: "birthDate" },
      { id: "civilite" },
    ],
  },
  {
    label: "address",
    fields: [
      { id: "addressStreet" },
      { id: "addressComplement" },
      { id: "postalCode" },
      { id: "city" },
      { id: "region" },
      { id: "department" },
      { id: "country" },
    ],
  },
  {
    label: "cotisation",
    fields: [
      { id: "amount" },
      { id: "periodStart" },
      { id: "periodEnd" },
      { id: "operationDate" },
      { id: "paymentStatus" },
      { id: "paymentMethod" },
      { id: "collecte" },
    ],
  },
]

function guessColumn(columns: string[], aliases: string[]): string {
  const normalized = columns.map(c => ({ original: c, normalized: normalizeHeader(c) }))
  const exact = normalized.find(c => aliases.includes(c.normalized))
  if (exact) return exact.original
  const partial = normalized.find(c => aliases.some(a => new RegExp(`\\b${a}\\b`).test(c.normalized)))
  return partial?.original ?? ""
}

function guessMapping(columns: string[]): { mapping: Partial<ColumnMapping>; detected: Set<FieldId> } {
  const available = [...columns]
  const mapping: Partial<ColumnMapping> = {}
  const detected = new Set<FieldId>()
  for (const group of FIELD_GROUPS) {
    for (const { id } of group.fields) {
      const col = guessColumn(available, FIELD_ALIASES[id])
      if (col) {
        mapping[id] = col
        detected.add(id)
        available.splice(available.indexOf(col), 1)
      }
    }
  }
  return { mapping, detected }
}

// Some AssoConnect exports (and files that have passed through LibreOffice) carry a stale
// `!ref` (declared used-range) in the sheet's XML — seen live on a real "Contacts" export
// whose dimension claimed only row 1 while all 97 rows of actual cell data were present in
// the parsed sheet, silently producing "0 lignes détectées". sheet_to_json trusts `!ref`
// rather than scanning cells itself, so recompute it from the real cell addresses first.
function recomputeSheetRange(sheet: XLSX.WorkSheet): void {
  const cellKeys = Object.keys(sheet).filter(k => !k.startsWith("!"))
  if (cellKeys.length === 0) return
  const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }
  for (const key of cellKeys) {
    const addr = XLSX.utils.decode_cell(key)
    if (addr.r > range.e.r) range.e.r = addr.r
    if (addr.c > range.e.c) range.e.c = addr.c
    if (addr.r < range.s.r) range.s.r = addr.r
    if (addr.c < range.s.c) range.s.c = addr.c
  }
  sheet["!ref"] = XLSX.utils.encode_range(range)
}

function parseDate(val: unknown): string {
  if (!val) return ""
  if (typeof val === "number") {
    const date = XLSX.SSF.parse_date_code(val)
    if (date) return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`
  }
  const s = String(val).trim()
  const parts = s.split(/[/\-.]/)
  if (parts.length === 3) {
    const [a, b, c] = parts
    if (c?.length === 4) return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`
    if (a?.length === 4) return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0]
}

function parseAmount(val: unknown): number {
  if (!val && val !== 0) return 0
  if (typeof val === "number") return val
  const s = String(val).trim().replace(/[\s€$]/g, "")
  if (!s) return 0
  const lastComma = s.lastIndexOf(",")
  const lastDot   = s.lastIndexOf(".")
  let normalized = s
  if (lastComma > lastDot) normalized = s.replace(/\./g, "").replace(",", ".")
  else if (lastDot > lastComma) normalized = s.replace(/,/g, "")
  return parseFloat(normalized) || 0
}

function mapSexe(val: unknown): "HOMME" | "FEMME" | undefined {
  // The AssoConnect "Contacts" export spells this out ("Masculin"/"Féminin"/"Non précisé")
  // instead of the short codes their own import template documents (F/M) — accept both.
  const s = String(val ?? "").trim().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  if (s === "F" || s === "FEMME" || s.startsWith("FEMININ")) return "FEMME"
  if (s === "M" || s === "HOMME" || s.startsWith("MASCULIN")) return "HOMME"
  return undefined
}

function mapCivilite(val: unknown): "MME" | "MLLE" | "M" | undefined {
  const s = String(val ?? "").trim().toLowerCase()
  if (s.startsWith("mme")) return "MME"
  if (s.startsWith("mlle")) return "MLLE"
  if (s === "m" || s.startsWith("m.")) return "M"
  return undefined
}

function mapMethod(val: unknown): "CB" | "CHQ" | "ESP" | "En ligne" | "Autre" | undefined {
  const s = String(val ?? "").trim().toLowerCase()
  if (!s) return undefined
  if (s.includes("ligne") || s.includes("stripe") || s.includes("carte")) return s.includes("ligne") ? "En ligne" : "CB"
  if (s.includes("espece") || s.includes("cash")) return "ESP"
  if (s.includes("cheque")) return "CHQ"
  return "Autre" // virement, prélèvement SEPA, etc. — no matching code, keep the info rather than drop it
}

function ColSelect({ value, onChange, columns, detected }: { value: string; onChange: (v: string) => void; columns: string[]; detected?: boolean }) {
  const t = useTranslations("membres.importWizard")
  return (
    <div className="flex items-center gap-1.5">
      <Select value={value} onValueChange={v => onChange(v ?? "")}>
        <SelectTrigger className="h-8 w-full max-w-[240px]"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">—</SelectItem>
          {columns.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        </SelectContent>
      </Select>
      {detected && <span className="shrink-0 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">{t("detected")}</span>}
    </div>
  )
}

export function MembreImportWizard() {
  const t = useTranslations("membres.importWizard")
  const [step, setStep]       = useState<Step>(1)
  const [file, setFile]       = useState<File | null>(null)
  const [rawRows, setRawRows] = useState<Record<string, unknown>[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [mapping, setMapping] = useState<ColumnMapping>({} as ColumnMapping)
  const [detected, setDetected] = useState<Set<FieldId>>(new Set())
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [inviteToPortal, setInviteToPortal] = useState(false)
  const [queued, setQueued] = useState<QueuedImport | null>(null)

  const handleFileSelect = useCallback((f: File) => {
    setFile(f)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const buffer   = e.target?.result as ArrayBuffer
        const workbook = XLSX.read(buffer, { type: "array", cellDates: false })
        const sheet    = workbook.Sheets[workbook.SheetNames[0]]
        recomputeSheetRange(sheet)
        const rows     = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })
        const headers  = rows.length > 0 ? Object.keys(rows[0]) : []
        const { mapping: guessed, detected: det } = guessMapping(headers)
        setRawRows(rows)
        setColumns(headers)
        setMapping(m => ({ ...m, ...guessed }))
        setDetected(det)
        setStep(2)
      } catch {
        toast.error(t("toasts.fileReadError"))
      }
    }
    reader.readAsArrayBuffer(f)
  }, [t])

  const VALID_EXTENSIONS = [".csv", ".xlsx", ".xls"]
  function isValidFile(f: File): boolean {
    const name = f.name.toLowerCase()
    return VALID_EXTENSIONS.some(ext => name.endsWith(ext))
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (!f) return
    if (!isValidFile(f)) { toast.error(t("toasts.unsupportedFormat")); return }
    handleFileSelect(f)
  }

  function updateMapping(id: FieldId, value: string) {
    setMapping(m => ({ ...m, [id]: value === "__none" ? "" : value }))
    setDetected(prev => { if (!prev.has(id)) return prev; const next = new Set(prev); next.delete(id); return next })
  }

  function parseRows(): ParsedRow[] {
    const get = (row: Record<string, unknown>, id: FieldId) => mapping[id] ? row[mapping[id]] : undefined

    return rawRows.map((row): ParsedRow => {
      const firstName = String(get(row, "firstName") ?? "").trim()
      const lastName  = String(get(row, "lastName") ?? "").trim()
      if (!firstName || !lastName) return { firstName, lastName, _error: "missingName" }

      const externalId = String(get(row, "externalId") ?? "").trim() || undefined
      const email = String(get(row, "email") ?? "").trim() || undefined
      const phone = String(get(row, "phoneMobile") ?? "").trim() || String(get(row, "phoneFixe") ?? "").trim() || undefined

      const addressParts = [
        String(get(row, "addressStreet") ?? "").trim(),
        String(get(row, "addressComplement") ?? "").trim(),
        [String(get(row, "postalCode") ?? "").trim(), String(get(row, "city") ?? "").trim()].filter(Boolean).join(" "),
        String(get(row, "country") ?? "").trim(),
      ].filter(Boolean)
      const address = addressParts.length > 0 ? addressParts.join(", ") : undefined

      const amount = parseAmount(get(row, "amount"))
      const periodStart = parseDate(get(row, "periodStart")) || undefined
      const periodEnd   = parseDate(get(row, "periodEnd")) || undefined
      const paidAt       = parseDate(get(row, "operationDate")) || undefined
      const statusRaw    = String(get(row, "paymentStatus") ?? "").trim().toLowerCase()
      const paymentReceived = statusRaw.includes("reçu") || statusRaw.includes("recu") || statusRaw.includes("payé") || statusRaw.includes("paye")
      const collecte = String(get(row, "collecte") ?? "").trim() || undefined

      return {
        firstName, lastName, externalId, email, phone, address,
        sexe:      mapSexe(get(row, "sexe")),
        civilite:  mapCivilite(get(row, "civilite")),
        birthDate: parseDate(get(row, "birthDate")) || undefined,
        year:      amount > 0 && periodStart ? Number(periodStart.slice(0, 4)) : undefined,
        amount:    amount > 0 ? amount : undefined,
        periodStart, periodEnd, paidAt,
        paymentReceived: amount > 0 ? paymentReceived : undefined,
        // Always fall back to "Autre" (never leave undefined) when a cotisation is being
        // created — otherwise a row marked "reçu" but with an unmapped/blank moyen de
        // paiement column would silently skip recordCotisationPayment server-side.
        method:    amount > 0 ? (mapMethod(get(row, "paymentMethod")) ?? "Autre") : undefined,
        note:      amount > 0 && collecte ? t("importedNote", { collecte }) : undefined,
      }
    })
  }

  function handlePreview() {
    if (!mapping.firstName || !mapping.lastName) {
      toast.error(t("toasts.selectNameColumns"))
      return
    }
    const rows = parseRows()
    if (rows.every(r => r._error)) {
      toast.error(t("toasts.noValidRows"))
      return
    }
    setParsedRows(rows)
    setStep(3)
  }

  async function handleImport() {
    setImporting(true)
    try {
      const res = await fetch("/api/membres/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows.filter(r => !r._error), inviteToPortal }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? t("toasts.importError"))
      }
      const data = await res.json() as { jobId: string; totalRows: number; schemaErrors: number }
      registerPendingBulkSend(data.jobId)
      setQueued(data)
      setStep(4)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.genericError"))
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setStep(1); setFile(null); setRawRows([]); setColumns([]); setMapping({} as ColumnMapping)
    setDetected(new Set()); setParsedRows([]); setInviteToPortal(false); setQueued(null)
  }

  const validRows   = parsedRows.filter(r => !r._error)
  const errorRows   = parsedRows.filter(r => r._error)
  const withPayment = validRows.filter(r => r.amount)

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} description={t("description")} />

      <div className="flex items-center gap-1 text-sm">
        {[
          { n: 1, label: t("steps.upload") },
          { n: 2, label: t("steps.mapping") },
          { n: 3, label: t("steps.preview") },
          { n: 4, label: t("steps.result") },
        ].map((s, i) => (
          <div key={s.n} className="flex items-center gap-1">
            {i > 0 && <CaretRightIcon className="size-4 text-muted-foreground" />}
            <span className={cn("font-medium", step === s.n ? "text-foreground" : step > s.n ? "text-green-600 dark:text-green-400" : "text-muted-foreground")}>
              {step > s.n ? <CheckCircleIcon className="inline size-4" /> : `${s.n}.`} {s.label}
            </span>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          className="rounded-lg border-2 border-dashed border-muted-foreground/30 p-12 text-center cursor-pointer hover:border-muted-foreground/60 transition-colors"
          onClick={() => document.getElementById("membre-import-file-input")?.click()}
        >
          <input
            id="membre-import-file-input"
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f) }}
          />
          <UploadSimpleIcon className="size-10 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">{t("step1.dropTitle")}</p>
          <p className="text-sm text-muted-foreground mt-1">{t("step1.dropSubtitle")}</p>
        </div>
      )}

      {step === 2 && (
        <div className="rounded-lg border bg-card p-6 space-y-5">
          <div>
            <p className="text-sm font-medium mb-1 text-muted-foreground">{t("step2.fileSelected")}</p>
            <div className="flex items-center gap-2 text-sm"><FileIcon className="size-4" />{t("step2.rowsDetected", { file: file?.name ?? "", count: rawRows.length })}</div>
          </div>

          <div className="rounded-lg border text-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("step2.adheraField")}</TableHead>
                  <TableHead>{t("step2.sourceColumn")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {FIELD_GROUPS.map(group => (
                  <Fragment key={group.label}>
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={2} className="pt-4 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t(`step2.groups.${group.label}`)}
                      </TableCell>
                    </TableRow>
                    {group.fields.map(({ id, required }) => (
                      <TableRow key={id}>
                        <TableCell className="whitespace-nowrap">
                          {t(`step2.fields.${id}`)}
                          {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
                        </TableCell>
                        <TableCell>
                          <ColSelect value={mapping[id] ?? ""} onChange={v => updateMapping(id, v)} columns={columns} detected={detected.has(id)} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={reset}>{t("step2.restart")}</Button>
            <Button onClick={handlePreview}>{t("step2.previewResult")}</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-lg border bg-card p-5">
            <h3 className="font-semibold mb-3">{t("step3.parsingResult")}</h3>
            <div className="grid grid-cols-3 gap-4 text-center mb-4">
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-2xl font-bold">{validRows.length}</p>
                <p className="text-xs text-muted-foreground">{t("step3.validRows")}</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-2xl font-bold">{withPayment.length}</p>
                <p className="text-xs text-muted-foreground">{t("step3.withPayment")}</p>
              </div>
              <div className="rounded-lg bg-muted/30 p-3">
                <p className="text-2xl font-bold text-muted-foreground">{errorRows.length}</p>
                <p className="text-xs text-muted-foreground">{t("step3.missingName")}</p>
              </div>
            </div>

            <div className="rounded-lg border text-xs overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("step3.name")}</TableHead>
                    <TableHead>{t("step3.email")}</TableHead>
                    <TableHead className="text-right">{t("step3.amount")}</TableHead>
                    <TableHead>{t("step3.period")}</TableHead>
                    <TableHead>{t("step3.status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {validRows.slice(0, 8).map((row, i) => (
                    <TableRow key={i}>
                      <TableCell>{row.firstName} {row.lastName}</TableCell>
                      <TableCell className="text-muted-foreground">{row.email ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">{row.amount ? `${row.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}` : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.periodStart ?? "—"}{row.periodEnd ? ` → ${row.periodEnd}` : ""}</TableCell>
                      <TableCell>{row.amount ? (row.paymentReceived ? t("step3.paid") : t("step3.pending")) : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {validRows.length > 8 && <p className="text-xs text-muted-foreground mt-2 text-center">{t("step3.moreRows", { count: validRows.length - 8 })}</p>}
          </div>

          <div className="rounded-lg border bg-card p-5">
            <CheckboxField
              label={t("step3.inviteLabel")}
              description={t("step3.inviteHint")}
              checked={inviteToPortal}
              onChange={e => setInviteToPortal(e.target.checked)}
            />
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>{t("step3.back")}</Button>
            <Button onClick={handleImport} loading={importing}>{t("step3.importAction", { count: validRows.length })}</Button>
          </div>
        </div>
      )}

      {step === 4 && queued && (
        <div className="rounded-lg border bg-card p-8 text-center space-y-4">
          <CheckCircleIcon className="size-12 mx-auto text-green-600 dark:text-green-400" />
          <h3 className="text-xl font-bold">{t("step4.queuedTitle")}</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">{t("step4.queuedHint", { count: queued.totalRows })}</p>
          {queued.schemaErrors > 0 && (
            <p className="text-sm text-amber-600 dark:text-amber-400 max-w-md mx-auto">
              {t("step4.schemaErrorsHint", { count: queued.schemaErrors })}
            </p>
          )}
          <div className="flex justify-center gap-3 pt-2">
            <Button variant="outline" onClick={reset}>{t("step4.importAnother")}</Button>
            <Button onClick={() => window.location.href = `${BASE_PATH}/dashboard/membres`}>{t("step4.goToMembres")}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
