export type AssocModules = {
  evenements:  boolean
  cotisations: boolean
  tresorerie:  boolean
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
  tresorerie:  true,
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
  finances:    false,
}

export const MODULE_LABELS: Record<keyof AssocModules, string> = {
  evenements:  "Événements",
  cotisations: "Cotisations",
  tresorerie:  "Trésorerie",
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
