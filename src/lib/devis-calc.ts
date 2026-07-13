import type { DevisItemInput } from "@/lib/schemas"

export interface DocumentTotals {
  subtotal:       number
  vatAmount:      number
  discountAmount: number
  total:          number
}

// react-hook-form's `valueAsNumber` yields NaN while a number input is transiently empty
// (e.g. the user selected-all to retype a value) — the live total preview in
// devis-form.tsx/facture-form.tsx calls this on every keystroke, so without this guard a
// single blank field flashes "NaN €" in the totals box until the field is refilled.
const orZero = (n: number) => (Number.isFinite(n) ? n : 0)

// Shared by Devis and Facture — both use the same line-item shape (quantity, unitPrice,
// vatRate, discount). Discount is applied per line before VAT; subtotal is post-discount,
// pre-tax, matching what's actually owed.
export function computeDocumentTotals(items: DevisItemInput[]): DocumentTotals {
  let subtotal       = 0
  let vatAmount       = 0
  let discountAmount = 0

  for (const item of items) {
    const quantity  = orZero(item.quantity)
    const unitPrice = orZero(item.unitPrice)
    const vatRate   = orZero(item.vatRate)
    const discount  = orZero(item.discount)
    const lineBase  = quantity * unitPrice - discount
    subtotal       += lineBase
    vatAmount        += lineBase * (vatRate / 100)
    discountAmount += discount
  }

  const round2 = (n: number) => Math.round(n * 100) / 100
  subtotal       = round2(subtotal)
  vatAmount        = round2(vatAmount)
  discountAmount = round2(discountAmount)

  return { subtotal, vatAmount, discountAmount, total: round2(subtotal + vatAmount) }
}

// subtotal/vatAmount/discountAmount/total are all stored in Decimal(10,2) columns — a
// document whose computed total overflows that precision would otherwise fail as a raw
// Postgres 500 on insert instead of a clean validation error.
export const MAX_DOCUMENT_TOTAL = 99_999_999.99

export function exceedsMaxTotal(totals: DocumentTotals): boolean {
  return totals.subtotal > MAX_DOCUMENT_TOTAL
    || totals.vatAmount > MAX_DOCUMENT_TOTAL
    || totals.total > MAX_DOCUMENT_TOTAL
}

interface StoredItem {
  description: string
  quantity:    unknown
  unitPrice:   unknown
  vatRate:     unknown
  discount:    unknown
}

// Devis→Facture conversion locks items so the two documents can't diverge — but the edit
// forms always submit the full `items` array (disabled inputs still hold their value in
// react-hook-form state), so a naive "items was present in the payload" check would reject
// every save, even ones that never touched an item. Compare by value instead: only a real
// change should trip the lock.
export function itemsUnchanged(existing: StoredItem[], next: DevisItemInput[]): boolean {
  if (existing.length !== next.length) return false
  return existing.every((item, i) => {
    const n = next[i]
    return item.description   === n.description
      && Number(item.quantity)  === n.quantity
      && Number(item.unitPrice) === n.unitPrice
      && Number(item.vatRate)   === n.vatRate
      && Number(item.discount)  === n.discount
  })
}
