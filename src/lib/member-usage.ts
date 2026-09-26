// How close an association is to its plan's member limit (the same limit assertMemberLimit
// enforces on ACTIF members). Thresholds are ratios so they scale with every plan — the
// product owner's reference is Starter / 30: warning from 25, critical from 28.
export type MemberUsageLevel = "normal" | "warning" | "critical"

const WARNING_RATIO  = { numerator: 25, denominator: 30 }
const CRITICAL_RATIO = { numerator: 28, denominator: 30 }

// Cross-multiplied instead of dividing, so the boundaries are exact (125/150 is warning,
// 140/150 is critical) with no floating-point drift.
function reachesRatio(activeCount: number, limit: number, ratio: { numerator: number; denominator: number }): boolean {
  return activeCount * ratio.denominator >= limit * ratio.numerator
}

export function memberUsageLevel(activeCount: number, limit: number): MemberUsageLevel {
  // A 0 limit already blocks every new member — nothing left to warn about.
  if (limit <= 0) return "critical"
  if (reachesRatio(activeCount, limit, CRITICAL_RATIO)) return "critical"
  if (reachesRatio(activeCount, limit, WARNING_RATIO)) return "warning"
  return "normal"
}

// Filled share of the usage bar, clamped to 0–100.
export function memberUsagePercent(activeCount: number, limit: number): number {
  if (limit <= 0) return 100
  return Math.min(100, Math.max(0, (activeCount / limit) * 100))
}
