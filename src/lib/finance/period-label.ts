import type { useTranslations } from "next-intl"
import type { CurrentPeriod } from "@/lib/finance/exercice"

// Client-side formatting counterpart of resolveCurrentPeriod (src/lib/finance/exercice.ts,
// server-only — imports NextResponse). Shared by the Événements/Dons/Boutique summary cards so
// "Exercice 2026" / "Exercice 2026–2027" / "2026" render identically everywhere, and go through
// next-intl like the rest of the app instead of being hardcoded French. `t` must be a
// translator scoped to the "common" namespace (useTranslations("common")), same as every page
// using this already has for its other shared strings.
export function formatPeriodLabel(
  t:      ReturnType<typeof useTranslations>,
  period: Pick<CurrentPeriod, "kind" | "startYear" | "endYear">,
): string {
  if (period.kind === "calendar") return String(period.startYear)
  return period.startYear === period.endYear
    ? t("period.exercice", { year: period.startYear })
    : t("period.exerciceRange", { startYear: period.startYear, endYear: period.endYear })
}
