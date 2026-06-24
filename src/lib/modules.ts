export type AssocModules = {
  evenements:  boolean
  cotisations: boolean
  tresorerie:  boolean
  actualites:  boolean
  messages:    boolean
  materiel:    boolean
  site:        boolean
  ia:          boolean
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
}

export function parseModules(raw: unknown): AssocModules {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_MODULES }
  return { ...DEFAULT_MODULES, ...(raw as Partial<AssocModules>) }
}
