import { useQuery } from "@tanstack/react-query"
import type { ChamadaPresencaStatusValue } from "@/lib/schemas"
import { apiErrorMessage } from "@/lib/api-error"

export type MembreChamadaPresenca = {
  id:     string
  status: ChamadaPresencaStatusValue
  sessao: {
    id:        string
    data:      string
    horario:   string | null
    atividade: string | null
    grupo:     { id: string; nome: string }
  }
}

export function useMembreChamadas(membreId: string | undefined) {
  return useQuery({
    queryKey: ["membres", membreId, "chamadas"],
    queryFn:  async () => {
      const res = await fetch(`/api/membres/${membreId}/chamadas`)
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement"))
      return res.json() as Promise<MembreChamadaPresenca[]>
    },
    enabled: !!membreId,
  })
}
