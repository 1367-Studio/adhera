import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { FactureRecueCreateInput, FactureRecueUpdateInput, FactureRecuePaymentInput } from "@/lib/schemas"
import { apiError } from "@/lib/api-error"

const QK = ["factures-recues"]

export type FactureRecuePayment = {
  id:        string
  amount:    string
  method:    string
  paidAt:    string
  note:      string | null
}

export type FactureRecue = {
  id:            string
  number:        string | null
  type:          "facture" | "devis_recu" | "comprovante" | "contrat" | "autre"
  issueDate:     string
  amount:        string
  // FORM-107 Fase 3 — amountPaid/PARTIELLEMENT_PAYEE mirror Facture's own payment-driven status.
  amountPaid:    string
  status:        "A_PAYER" | "PARTIELLEMENT_PAYEE" | "PAYEE" | "EN_LITIGE" | "ANNULEE"
  fileUrl:       string
  notes:         string | null
  fournisseurId: string | null
  fournisseur:   { id: string; companyName: string } | null
  payments?:     FactureRecuePayment[]
}

export type FacturesRecuesPage = { data: FactureRecue[]; total: number; page: number; limit: number; totalPages: number }

async function fetchFacturesRecues(fournisseurId?: string): Promise<FactureRecue[]> {
  const params = new URLSearchParams()
  if (fournisseurId) params.set("fournisseurId", fournisseurId)
  const res = await fetch(`/api/factures-recues?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des documents")
  return res.json()
}

async function fetchFacturesRecuesPaginated(page: number, limit: number, fournisseurId?: string): Promise<FacturesRecuesPage> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (fournisseurId) params.set("fournisseurId", fournisseurId)
  const res = await fetch(`/api/factures-recues?${params}`)
  if (!res.ok) throw new Error("Erreur lors du chargement des documents")
  return res.json()
}

async function createFactureRecue(data: FactureRecueCreateInput) {
  const res = await fetch("/api/factures-recues", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la création")
  return res.json()
}

async function updateFactureRecue(id: string, data: FactureRecueUpdateInput) {
  const res = await fetch(`/api/factures-recues/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la mise à jour")
  return res.json()
}

// force: true confirms deleting a document that already has payments recorded (FORM-107
// Fase 3) — the route 409s with REQUIRES_CONFIRMATION otherwise, same posture as Facture's
// own DELETE. The UI's own ConfirmDialog is what stands in for that confirmation.
async function deleteFactureRecue(id: string, force?: boolean) {
  const res = await fetch(`/api/factures-recues/${id}`, {
    method:  "DELETE",
    ...(force ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) } : {}),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la suppression")
}

async function addFactureRecuePayment(id: string, data: FactureRecuePaymentInput) {
  const res = await fetch(`/api/factures-recues/${id}/payments`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de l'enregistrement du paiement")
  return res.json()
}

async function removeFactureRecuePayment(id: string, paymentId: string) {
  const res = await fetch(`/api/factures-recues/${id}/payments/${paymentId}`, { method: "DELETE" })
  if (!res.ok) throw await apiError(res, "Erreur lors de la suppression du paiement")
  return res.json()
}

export function useFacturesRecues(fournisseurId?: string) {
  return useQuery({
    queryKey:  [...QK, fournisseurId ?? "all"],
    queryFn:   () => fetchFacturesRecues(fournisseurId),
    staleTime: 0,
  })
}

export function useFacturesRecuesPaginated(page: number, limit: number, fournisseurId?: string) {
  return useQuery({
    queryKey:  [...QK, "paginated", page, limit, fournisseurId ?? "all"],
    queryFn:   () => fetchFacturesRecuesPaginated(page, limit, fournisseurId),
    staleTime: 0,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
}

export function useCreateFactureRecue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createFactureRecue,
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useUpdateFactureRecue(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: FactureRecueUpdateInput) => updateFactureRecue(id, data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useDeleteFactureRecue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; force?: boolean } | string) =>
      typeof vars === "string" ? deleteFactureRecue(vars) : deleteFactureRecue(vars.id, vars.force),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useAddFactureRecuePayment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: FactureRecuePaymentInput) => addFactureRecuePayment(id, data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useRemoveFactureRecuePayment(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (paymentId: string) => removeFactureRecuePayment(id, paymentId),
    onSuccess:  () => invalidateAll(qc),
  })
}
