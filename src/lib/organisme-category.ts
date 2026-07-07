import { OrganismeCategory } from "@prisma/client"

export const ORGANISME_CATEGORY_GROUPS: {
  label: string
  options: { value: OrganismeCategory; label: string }[]
}[] = [
  {
    label: "Intérêt général",
    options: [
      { value: "ASSOCIATION_LOI_1901", label: "Association loi 1901" },
      { value: "FONDATION_RECONNUE_UTILITE_PUBLIQUE", label: "Association ou fondation reconnue d'utilité publique" },
      { value: "FONDATION_UNIVERSITAIRE_PARTENARIALE", label: "Fondation universitaire ou partenariale" },
      { value: "FONDATION_ENTREPRISE", label: "Fondation d'entreprise" },
      { value: "MUSEE_DE_FRANCE", label: "Musée de France" },
      { value: "AIDE_ALIMENTAIRE_SOCIALE", label: "Organisme d'aide alimentaire, sociale ou de logement" },
      { value: "AUTRE_INTERET_GENERAL", label: "Autre organisme d'intérêt général" },
    ],
  },
  {
    label: "Autres organismes",
    options: [
      { value: "ASSOCIATION_CULTUELLE_ALSACE_MOSELLE", label: "Association cultuelle ou établissement public des cultes (Alsace-Moselle)" },
      { value: "ETABLISSEMENT_ENSEIGNEMENT_SUPERIEUR", label: "Établissement d'enseignement supérieur ou artistique, à but non lucratif" },
      { value: "ETABLISSEMENT_ENSEIGNEMENT_SUPERIEUR_CONSULAIRE", label: "Établissement d'enseignement supérieur consulaire" },
      { value: "ORGANISME_RECHERCHE_SCIENTIFIQUE", label: "Organisme agréé de recherche scientifique et technique" },
      { value: "ORGANISME_SPECTACLE_EXPOSITIONS", label: "Organisme de spectacle vivant ou d'expositions d'art contemporain" },
      { value: "PROJET_THESE_DOCTORAT", label: "Projet de thèse proposé au mécénat de doctorat" },
      { value: "SOCIETE_EXPOSITIONS_UNIVERSELLES", label: "Société de représentation de la France aux expositions universelles" },
      { value: "SOCIETE_PROGRAMME_AUDIOVISUEL", label: "Société nationale de programme (audiovisuel culturel)" },
      { value: "FONDATION_PATRIMOINE", label: "Fondation du patrimoine ou organisme subventionnant des monuments historiques" },
      { value: "FONDS_DOTATION", label: "Fonds de dotation" },
      { value: "ORGANISME_AIDE_PME", label: "Organisme agréé d'aide aux petites et moyennes entreprises" },
      { value: "FEDERATION_ORGANISMES_AGREES", label: "Fédération d'organismes agréés" },
      { value: "ORGANISME_PROTECTION_BIENS_CULTURELS", label: "Organisme de protection des biens culturels en cas de conflit armé" },
      { value: "ORGANISME_UE_SIMILAIRE", label: "Organisme UE (ou Norvège/Islande/Liechtenstein) similaire" },
    ],
  },
]

const LABEL_BY_VALUE = new Map(
  ORGANISME_CATEGORY_GROUPS.flatMap(g => g.options).map(o => [o.value, o.label]),
)

export function organismeCategoryLabel(category: OrganismeCategory): string {
  return LABEL_BY_VALUE.get(category) ?? category
}
