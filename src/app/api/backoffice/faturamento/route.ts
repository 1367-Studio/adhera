import { NextResponse } from "next/server"
import { stripe } from "@/lib/stripe"
import { withSuperAdminAuth } from "@/lib/api-wrapper"

const FIRST_YEAR = 2024 // earliest year selectable — before this the platform had no Stripe activity

// Balance-transaction types that move cash between Stripe and the bank account rather than
// representing revenue. A payout doesn't add or remove money that was already counted when
// the underlying charge/application_fee balance transaction landed — including it here would
// double-subtract revenue that's already been recognized in an earlier (or the same) month.
const NON_REVENUE_TYPES = new Set(["payout", "payout_cancel", "payout_failure"])

// The app is French-facing and every "month" in the chart should match a Paris calendar month,
// not a UTC one — a transaction just after 22:00 UTC in winter (23:00 Paris) or 21:00 UTC in
// summer (23:00 Paris) can sit on the wrong side of a UTC month boundary while still being
// firmly inside "this month" for a French admin reading the chart.
const PARIS_MONTH = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", month: "numeric" })
const PARIS_YEAR  = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", year: "numeric" })

function parisMonth(date: Date): number {
  return Number(PARIS_MONTH.format(date))
}

// Jan 1st is always CET (UTC+1) in Europe/Paris — DST only runs late March to late October —
// so the offset here is safe to hard-code rather than needing real timezone-conversion math.
function parisYearStartMs(year: number): number {
  return Date.UTC(year, 0, 1) - 3600_000
}

type FaturamentoData = {
  year:        number
  currentYear: number
  firstYear:   number
  months:      { month: number; netCents: number; hasData: boolean }[]
}

// Past years are immutable — Stripe's ledger for e.g. 2025 never changes once 2026 starts — so
// they're safe to cache for a long time. The current (still-accumulating) year gets a short TTL
// instead. Same reasoning as `pricingCache` in src/lib/stripe.ts, just per-year here.
const cache = new Map<number, { data: FaturamentoData; expiresAt: number }>()
const CURRENT_YEAR_CACHE_TTL_MS = 5 * 60_000
const PAST_YEAR_CACHE_TTL_MS    = 24 * 60 * 60_000

async function computeFaturamento(year: number, currentYear: number, now: Date): Promise<FaturamentoData> {
  const rangeStart = parisYearStartMs(year) / 1000
  // For the current year, stop at "now" instead of year end so we never ask Stripe for a
  // future window; for past years the window runs through the Paris-local year end.
  const rangeEnd = year === currentYear
    ? Math.floor(now.getTime() / 1000)
    : parisYearStartMs(year + 1) / 1000

  // Net revenue per calendar month (index 0 = January), in cents. Every balance-transaction
  // type except payouts counts: charges and application fees (the 1% Connect commission) add,
  // refunds and disputes subtract — this is what actually landed in the platform's own Stripe
  // balance, not the gross amount of every charge (destination-charge transfers to associations'
  // connected accounts net back out automatically).
  const monthlyNetCents = new Array(12).fill(0)

  for await (const txn of stripe.balanceTransactions.list({
    created: { gte: rangeStart, lt: rangeEnd },
    limit:   100,
  })) {
    if (NON_REVENUE_TYPES.has(txn.type)) continue
    monthlyNetCents[parisMonth(new Date(txn.created * 1000)) - 1] += txn.net
  }

  const currentMonth = parisMonth(now)
  const months = monthlyNetCents.map((netCents, index) => ({
    month:      index + 1,
    netCents,
    // Months after "now" in the current year never got queried — mark them so the chart can
    // stop the line there instead of plotting a false drop to zero for the rest of the year.
    hasData:    year < currentYear || index + 1 <= currentMonth,
  }))

  return { year, currentYear, firstYear: FIRST_YEAR, months }
}

export const GET = withSuperAdminAuth(async (req) => {
  const url = new URL(req.url)
  const now = new Date()
  const currentYear = Number(PARIS_YEAR.format(now))

  const yearParam = Number(url.searchParams.get("year"))
  const year = Number.isInteger(yearParam) && yearParam >= FIRST_YEAR && yearParam <= currentYear
    ? yearParam
    : currentYear

  const cached = cache.get(year)
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data)
  }

  const data = await computeFaturamento(year, currentYear, now)
  const ttl = year === currentYear ? CURRENT_YEAR_CACHE_TTL_MS : PAST_YEAR_CACHE_TTL_MS
  cache.set(year, { data, expiresAt: Date.now() + ttl })

  return NextResponse.json(data)
})
