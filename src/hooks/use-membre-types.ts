import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { MembreTypeInput, MembreTypeUpdateInput } from "@/lib/schemas"
import { apiErrorMessage } from "@/lib/api-error"

const QK      = ["membre-types"]
const QK_MBRS = ["membres"]

export type MembreType = {
  id:          string
  name:        string
  description: string | null
  color:       string
  _count:      { membres: number }
}

async function fetchMembreTypes(): Promise<MembreType[]> {
  const res = await fetch("/api/membre-types")
  if (!res.ok) throw new Error("Erreur lors du chargement")
  return res.json()
}

export function useMembreTypes() {
  return useQuery({ queryKey: QK, queryFn: fetchMembreTypes })
}

export function useCreateMembreType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: MembreTypeInput) => {
      const res = await fetch("/api/membre-types", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json()
    },
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: QK }),
      qc.invalidateQueries({ queryKey: QK_MBRS }),
    ]),
  })
}

export function useUpdateMembreType(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: MembreTypeUpdateInput) => {
      const res = await fetch(`/api/membre-types/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json()
    },
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: QK }),
      qc.invalidateQueries({ queryKey: QK_MBRS }),
    ]),
  })
}

export function useDeleteMembreType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/membre-types/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
    },
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: QK }),
      qc.invalidateQueries({ queryKey: QK_MBRS }),
    ]),
  })
}
