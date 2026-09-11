// Exact keys = dashboard route segments of the app (see the help-center contract).
export type HelpModuleOption = { value: string; title: string }

export const HELP_MODULES: HelpModuleOption[] = [
  { value: "dashboard", title: "Tableau de bord" },
  { value: "membres", title: "Membres" },
  { value: "adhesions", title: "Adhésions" },
  { value: "cotisations", title: "Cotisations" },
  { value: "dons", title: "Dons" },
  { value: "evenements", title: "Événements" },
  { value: "messages", title: "Messagerie" },
  { value: "reunions", title: "Réunions" },
  { value: "sondages", title: "Sondages" },
  { value: "actualites", title: "Actualités" },
  { value: "suporte", title: "Support" },
  { value: "finances", title: "Suivi financier" },
  { value: "devis", title: "Devis" },
  { value: "factures", title: "Factures" },
  { value: "fournisseurs", title: "Fournisseurs" },
  { value: "materiel", title: "Matériel" },
  { value: "site", title: "Site web" },
  { value: "boutique", title: "Boutique" },
  { value: "activite", title: "Historique" },
  { value: "parametres", title: "Paramètres" },
  { value: "general", title: "Général" },
]

export function helpModuleTitle(moduleValue: string | undefined | null): string | undefined {
  if (!moduleValue) return undefined
  return HELP_MODULES.find((helpModule) => helpModule.value === moduleValue)?.title ?? moduleValue
}
