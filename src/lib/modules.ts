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
  fournisseurs: boolean
  devis:        boolean
  factures:     boolean
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
  fournisseurs: false,
  devis:        false,
  factures:     false,
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
  fournisseurs: "Fournisseurs",
  devis:        "Devis",
  factures:     "Factures",
}

export function parseModules(raw: unknown): AssocModules {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MODULES }
  return { ...DEFAULT_MODULES, ...(raw as Partial<AssocModules>) }
}

// Single source of truth for portal nav order — shared by PortalSidebar (which nav item
// renders first) and the /portal/[slug] landing redirect (which page a member lands on),
// so the two never drift apart when a module gets disabled.
export const PORTAL_NAV_ORDER: Array<{ path: string; moduleKey?: keyof AssocModules }> = [
  { path: "actualites",     moduleKey: "actualites"  },
  { path: "evenements",     moduleKey: "evenements"  },
  { path: "cotisation",     moduleKey: "cotisations" },
  { path: "communications" },
  { path: "reunions",       moduleKey: "reunions"    },
  { path: "sondages",       moduleKey: "sondages"    },
  { path: "dons",           moduleKey: "dons"        },
  { path: "boutique",       moduleKey: "boutique"    },
  { path: "materiel",       moduleKey: "materiel"    },
  { path: "profil"         },
]

// "communications" and "profil" have no moduleKey, so one of them always matches — in
// practice "communications" (it comes first) is the true fallback when every optional
// module is off, never "profil". The `?? last item` below only exists to satisfy
// TypeScript's find() typing and is never actually reached.
export function firstEnabledPortalPath(modules: AssocModules): string {
  const item = PORTAL_NAV_ORDER.find(item => !item.moduleKey || modules[item.moduleKey])
  return (item ?? PORTAL_NAV_ORDER[PORTAL_NAV_ORDER.length - 1]).path
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
