import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { ChamadaCreateInput, ChamadaUpdateInput, ChamadaPresencaStatusValue } from "@/lib/schemas"
import { apiError, apiErrorMessage } from "@/lib/api-error"

const QK = (grupoId: string) => ["grupos", grupoId, "chamadas"]

export type ChamadaPresencaMembro = {
  id:       string
  membreId: string
  status:   ChamadaPresencaStatusValue
  membre:   { id: string; firstName: string; lastName: string }
}

export type ChamadaSessaoListItem = {
  id:        string
  data:      string
  horario:   string | null
  atividade: string | null
  counts:    Record<ChamadaPresencaStatusValue, number>
}

export type ChamadaSessaoDetail = {
  id:        string
  grupoId:   string
  grupoNome: string
  data:      string
  horario:   string | null
  atividade: string | null
  updatedAt: string
  presencas: ChamadaPresencaMembro[]
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement"))
  return res.json()
}

export function useGrupoChamadas(grupoId: string | undefined) {
  return useQuery({
    queryKey: grupoId ? QK(grupoId) : ["grupos", "chamadas", "disabled"],
    queryFn:  () => fetchJson<ChamadaSessaoListItem[]>(`/api/grupos/${grupoId}/chamadas`),
    enabled:  !!grupoId,
  })
}

export function useChamada(grupoId: string | undefined, chamadaId: string | undefined) {
  return useQuery({
    queryKey: ["grupos", grupoId, "chamadas", chamadaId],
    queryFn:  () => fetchJson<ChamadaSessaoDetail>(`/api/grupos/${grupoId}/chamadas/${chamadaId}`),
    enabled:  !!grupoId && !!chamadaId,
  })
}

export function useCreateChamada(grupoId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: ChamadaCreateInput) => {
      const res = await fetch(`/api/grupos/${grupoId}/chamadas`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      })
      // 409 = un appel existe déjà pour ce créneau (error.details.chamadaId) : l'appelant
      // (page détail du groupe) propose alors de l'ouvrir au lieu d'afficher juste une erreur.
      if (!res.ok) throw await apiError(res, "Erreur")
      return res.json() as Promise<ChamadaSessaoDetail>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QK(grupoId) }),
  })
}

export function useSaveChamada(grupoId: string, chamadaId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: ChamadaUpdateInput) => {
      const res = await fetch(`/api/grupos/${grupoId}/chamadas/${chamadaId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json() as Promise<ChamadaSessaoDetail>
    },
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: QK(grupoId) }),
      qc.invalidateQueries({ queryKey: ["grupos", grupoId, "chamadas", chamadaId] }),
    ]),
  })
}

// FORM-97 edge case : ajoute une présence NAO_INFORMADO pour tout membre du groupe qui a
// rejoint après la création de cet appel (voir /sync route).
export function useSyncChamadaMembres(grupoId: string, chamadaId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/grupos/${grupoId}/chamadas/${chamadaId}/sync`, { method: "POST" })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json() as Promise<ChamadaSessaoDetail & { addedCount: number }>
    },
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: QK(grupoId) }),
      qc.invalidateQueries({ queryKey: ["grupos", grupoId, "chamadas", chamadaId] }),
    ]),
  })
}
