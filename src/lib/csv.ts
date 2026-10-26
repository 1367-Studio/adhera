// CSV built in the browser for French Excel: UTF-8 with a BOM (without it Excel reads the file
// as Windows-1252 and mangles every accent), « ; » as separator (Excel in a French locale uses
// the comma as decimal separator, so it expects semicolons between cells), CRLF line endings.
// Every cell is quoted, and a cell starting with =, +, -, @, tab or CR is prefixed with « ' »
// so Excel/Sheets never run it as a formula — same guard as the presences export route, since
// names and e-mails come from public, unauthenticated registration.
const UTF8_BYTE_ORDER_MARK = "﻿"

export type CsvCell = string | number | null | undefined

function sanitizeCsvCell(cell: CsvCell): string {
  if (cell == null) return ""
  const text = String(cell)
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

export function buildCsv(rows: CsvCell[][], separator = ";"): string {
  const lines = rows.map(row =>
    row.map(cell => `"${sanitizeCsvCell(cell).replace(/"/g, '""')}"`).join(separator))
  return UTF8_BYTE_ORDER_MARK + lines.join("\r\n") + "\r\n"
}

// Browser only: hands a CSV string to the user as a file download.
export function downloadCsv(csvContent: string, fileName: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}
