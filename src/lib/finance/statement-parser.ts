import * as XLSX from "xlsx"
import crypto from "crypto"
import type { ImportColumnMapping, ImportRow } from "@/lib/schemas/finance"

function parseDate(val: unknown): string {
  if (!val) return ""
  if (typeof val === "number") {
    const date = XLSX.SSF.parse_date_code(val)
    if (date) {
      const m = String(date.m).padStart(2, "0")
      const d = String(date.d).padStart(2, "0")
      return `${date.y}-${m}-${d}`
    }
  }
  const s = String(val).trim()
  const parts = s.split(/[\/\-\.]/)
  if (parts.length === 3) {
    const [a, b, c] = parts
    if (c && c.length === 4) return `${c}-${b.padStart(2,"0")}-${a.padStart(2,"0")}`
    if (a && a.length === 4) return `${a}-${b.padStart(2,"0")}-${c.padStart(2,"0")}`
  }
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0]
  return s
}

function parseAmount(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0
  if (typeof val === "number") return val
  return parseFloat(String(val).replace(/\s/g, "").replace(",", ".")) || 0
}

function makeExternalId(bankAccountId: string, row: Omit<ImportRow, "externalId">): string {
  const raw = `${bankAccountId}|${row.transactionDate}|${row.label}|${row.amount}|${row.type}`
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32)
}

export function parseStatementBuffer(
  buffer: Buffer,
  mapping: ImportColumnMapping,
): ImportRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false })
  const sheet    = workbook.Sheets[workbook.SheetNames[0]]
  const rows     = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })

  const result: ImportRow[] = []

  for (const row of rows) {
    const rawDate  = row[mapping.dateColumn]
    const rawLabel = String(row[mapping.labelColumn] ?? "").trim()
    const dateStr  = parseDate(rawDate)

    if (!dateStr || !rawLabel) continue

    let amount = 0
    let type: "CREDIT" | "DEBIT" = "CREDIT"

    if (mapping.valueMode === "single" && mapping.amountColumn) {
      const raw = parseAmount(row[mapping.amountColumn])
      amount = Math.abs(raw)
      type   = raw >= 0 ? "CREDIT" : "DEBIT"
    } else if (mapping.valueMode === "split") {
      const debit  = mapping.debitColumn  ? parseAmount(row[mapping.debitColumn])  : 0
      const credit = mapping.creditColumn ? parseAmount(row[mapping.creditColumn]) : 0
      if (credit > 0) { amount = credit; type = "CREDIT" }
      else if (debit > 0) { amount = debit; type = "DEBIT" }
      else continue
    }

    if (amount === 0) continue

    const balanceAfter = mapping.balanceColumn
      ? parseAmount(row[mapping.balanceColumn]) || undefined
      : undefined

    const partial = { transactionDate: dateStr, label: rawLabel, amount, type, balanceAfter }
    const externalId = makeExternalId(mapping.bankAccountId, partial as Omit<ImportRow, "externalId">)

    result.push({ ...partial, externalId } as ImportRow)
  }

  return result
}

export function getSheetColumns(buffer: Buffer): string[] {
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheet    = workbook.Sheets[workbook.SheetNames[0]]
  const rows     = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })
  if (!rows.length) return []
  return Object.keys(rows[0])
}

export function getSheetPreview(buffer: Buffer, limit = 5): Record<string, unknown>[] {
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const sheet    = workbook.Sheets[workbook.SheetNames[0]]
  const rows     = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })
  return rows.slice(0, limit)
}
