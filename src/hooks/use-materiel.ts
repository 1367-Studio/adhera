import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

export type MaterialStatus = "DISPONIBLE" | "EN_USE" | "EN_MAINTENANCE" | "HORS_SERVICE" | "PERDU"

export type LoanStatus = "DEMANDE" | "CONFIRME" | "REFUSE"

export type MaterialLoan = {
  id:               string
  materialId:       string
  membreId:         string | null
  borrowerName:     string | null
  quantity:         number
  status:           LoanStatus
  borrowedAt:       string
  expectedReturnAt: string | null
  returnedAt:       string | null
  feeAmount:        string | null
  notes:            string | null
  membre:           { firstName: string; lastName: string; email: string | null } | null
  facture:          { id: string; number: string; status: string } | null
}

export type PendingDemande = {
  id:               string
  quantity:         number
  status:           "DEMANDE"
  borrowedAt:       string
  expectedReturnAt: string | null
  notes:            string | null
  membreId:         string | null
  borrowerName:     string | null
  membre:           { firstName: string; lastName: string } | null
}

export type Material = {
  id:                   string
  name:                 string
  category:             string | null
  categoryId:           string | null
  description:          string | null
  serialNumber:         string | null
  quantity:             number
  status:               MaterialStatus
  location:             string | null
  purchaseDate:         string | null
  purchasePrice:        string | null
  rentalRate:           string | null
  imageUrl:             string | null
  notes:                string | null
  createdAt:            string
  loanedQty:            number
  reservedQty:          number
  availableQty:         number
  pendingDemandesCount: number
  pendingDemandes:      PendingDemande[]
  overdueCount:         number
  _count:               { loans: number }
}

export type MaterialDetail = Material & { loans: MaterialLoan[]; financeCategory: { id: string; name: string } | null }

export type MaterialInput = {
  name:          string
  category?:     string | null
  categoryId?:   string | null
  description?:  string | null
  serialNumber?: string | null
  quantity:      number
  status:        MaterialStatus
  location?:     string | null
  purchaseDate?: string | null
  purchasePrice?: number | null
  rentalRate?:   number | null
  imageUrl?:     string | null
  notes?:        string | null
}

export type LoanInput = {
  membreId?:        string | null
  borrowerName?:    string | null
  quantity:         number
  borrowedAt?:      string
  expectedReturnAt?: string | null
  feeAmount?:       number | null
  notes?:           string | null
}

const KEY       = ["materiel"]
const detailKey = (id: string) => ["materiel", id]

function invalidateAll(qc: ReturnType<typeof useQueryClient>, id?: string) {
  const ops = [
    qc.invalidateQueries({ queryKey: KEY }),
    qc.invalidateQueries({ queryKey: ["portal-materiel"] }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  ]
  if (id) ops.push(qc.invalidateQueries({ queryKey: detailKey(id) }))
  return Promise.all(ops)
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error ?? "Erreur")
  }
  return res.status === 204 ? null : res.json()
}

export function useMateriel(search?: string) {
  return useQuery<Material[]>({
    queryKey:  [...KEY, search],
    queryFn:   () => {
      const p = new URLSearchParams()
      if (search) p.set("search", search)
      const qs = p.toString()
      return fetchJson(qs ? `/api/materiel?${qs}` : "/api/materiel")
    },
    staleTime: 0,
  })
}

export type MaterielStats = {
  totalRevenue:      number
  topLoaned:         { name: string; count: number }[]
  revenueByMaterial: { name: string; amount: number }[]
}

export function useMaterielStats() {
  return useQuery<MaterielStats>({
    queryKey:  ["materiel", "stats"],
    queryFn:   () => fetchJson("/api/materiel/stats"),
    staleTime: 60_000,
  })
}

export function useMaterialDetail(id: string | null) {
  return useQuery<MaterialDetail>({
    queryKey:  detailKey(id ?? ""),
    queryFn:   () => fetchJson(`/api/materiel/${id}`),
    enabled:   !!id,
    staleTime: 0,
  })
}

export function useCreateMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: MaterialInput) => fetchJson("/api/materiel", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateMaterial(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<MaterialInput>) => fetchJson(`/api/materiel/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }),
    onSuccess: () => invalidateAll(qc, id),
  })
}

export function useDeleteMaterial() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => fetchJson(`/api/materiel/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useCreateLoan(materialId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: LoanInput) => fetchJson(`/api/materiel/${materialId}/loans`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    }),
    onSuccess: () => invalidateAll(qc, materialId),
  })
}

export function useReturnLoan(materialId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (loanId: string) => fetchJson(`/api/materiel/${materialId}/loans/${loanId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "return" }),
    }),
    onSuccess: () => invalidateAll(qc, materialId),
  })
}

export function useConfirmLoan(materialId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (loanId: string) => fetchJson(`/api/materiel/${materialId}/loans/${loanId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm" }),
    }),
    onSuccess: () => invalidateAll(qc, materialId),
  })
}

export function useRefuseLoan(materialId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (loanId: string) => fetchJson(`/api/materiel/${materialId}/loans/${loanId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refuse" }),
    }),
    onSuccess: () => invalidateAll(qc, materialId),
  })
}

export function useSendLoanEmail(materialId: string) {
  return useMutation({
    mutationFn: ({ loanId, to, message }: { loanId: string; to: string; message?: string }) =>
      fetchJson(`/api/materiel/${materialId}/loans/${loanId}/send-email`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, message }),
      }),
  })
}

export function useGenerateLoanFacture(materialId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (loanId: string) => fetchJson(`/api/materiel/${materialId}/loans/${loanId}/facture`, { method: "POST" }),
    onSuccess: () => invalidateAll(qc, materialId),
  })
}

export function useDeleteLoan(materialId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (loanId: string) => fetchJson(`/api/materiel/${materialId}/loans/${loanId}`, { method: "DELETE" }),
    onSuccess: () => invalidateAll(qc, materialId),
  })
}
