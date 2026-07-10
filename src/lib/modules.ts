export type AssocModules = {
  evenements:  boolean
  cotisations: boolean
  actualites:  boolean
  messages:    boolean
  materiel:    boolean
  site:        boolean
  ia:          boolean
  dons:        boolean
  sondages:    boolean
  boutique:    boolean
  reunions:    boolean
  sms:         boolean
  finances:    boolean
}

export const DEFAULT_MODULES: AssocModules = {
  evenements:  true,
  cotisations: true,
  actualites:  true,
  messages:    true,
  materiel:    true,
  site:        true,
  ia:          false,
  dons:        false,
  sondages:    true,
  boutique:    false,
  reunions:    false,
  sms:         false,
  finances:    true,
}

export const MODULE_LABELS: Record<keyof AssocModules, string> = {
  evenements:  "Événements",
  cotisations: "Cotisations",
  actualites:  "Actualités",
  messages:    "Messages automatiques",
  materiel:    "Matériel",
  site:        "Site web intégré",
  ia:          "Rédaction assistée par IA",
  dons:        "Dons en ligne",
  sondages:    "Sondages",
  boutique:    "Boutique en ligne",
  reunions:    "Réunions vidéo",
  sms:         "Notifications SMS",
  finances:    "Finances & Conciliation bancaire",
}

export function parseModules(raw: unknown): AssocModules {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MODULES }
  return { ...DEFAULT_MODULES, ...(raw as Partial<AssocModules>) }
}

// The Pro tier includes IA (see form-wise-app's Pricing.associations.plans.pro.features).
// This only ever turns a module ON on top of what's stored — the backoffice's manual
// per-association toggle (src/app/backoffice/associations/[id]/page.tsx) still works as
// an override on Essentiel (e.g. a courtesy enable), it's just never able to turn Pro's
// included modules back off.
export function deriveModulesForPlan(plan: "ESSENTIAL" | "PRO", modules: AssocModules): AssocModules {
  if (plan !== "PRO") return modules
  return { ...modules, ia: true }
}
