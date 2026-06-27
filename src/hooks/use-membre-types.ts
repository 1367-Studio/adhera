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
  return useQuery({ queryKey: QK, queryFn: fetchMembreTypes, staleTime: 0 })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    qc.invalidateQueries({ queryKey: QK_MBRS }),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
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
    onSuccess: () => invalidateAll(qc),
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
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteMembreType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/membre-types/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
    },
    onSuccess: () => invalidateAll(qc),
  })
}
