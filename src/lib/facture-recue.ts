// Labels used when a FactureRecue marked payée bridges into an Expense — kept distinct
// from the FactureRecue type labels shown in the UI (documentTypeLabel in
// fournisseur-detail-view.tsx) since these read as a ledger line, not a document type.
const EXPENSE_TYPE_LABEL: Record<string, string> = {
  facture:     "Facture reçue",
  devis_recu:  "Devis reçu",
  comprovante: "Justificatif",
  contrat:     "Contrat",
  autre:       "Document reçu",
}

export function factureRecueExpenseDescription(factureRecue: { number: string | null; type: string }): string {
  const label = EXPENSE_TYPE_LABEL[factureRecue.type] ?? "Facture reçue"
  return `${label} ${factureRecue.number ?? factureRecue.type}`
}
