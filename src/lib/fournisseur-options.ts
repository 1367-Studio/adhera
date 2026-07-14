import type { FournisseurRef } from "@/hooks/use-fournisseurs"

const STATUS_SUFFIX: Record<FournisseurRef["status"], string> = {
  ACTIF:   "",
  INACTIF: " (inactif)",
  ARCHIVE: " (archivé)",
}

// ACTIF suppliers first (the common case when picking a new one), INACTIF/ARCHIVE after
// and labeled — still selectable so a Devis/Facture already linked to one doesn't show
// up blank in the edit form (see [[project-devis-facture-fournisseur-modules]]). A
// soft-deleted supplier (only present at all when passed as `includeId` to
// useFournisseursList) is labeled "(archivé)" regardless of its status field.
export function buildFournisseurOptions(fournisseurs: FournisseurRef[]) {
  const sorted = [...fournisseurs].sort((a, b) => {
    if (a.status === b.status) return a.companyName.localeCompare(b.companyName)
    return a.status === "ACTIF" ? -1 : b.status === "ACTIF" ? 1 : 0
  })
  return [
    { value: "", label: "Aucun (client ponctuel)" },
    ...sorted.map(f => ({ value: f.id, label: `${f.companyName}${f.deletedAt ? " (archivé)" : STATUS_SUFFIX[f.status]}` })),
  ]
}
