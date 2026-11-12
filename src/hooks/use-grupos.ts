import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { GrupoInput, GrupoUpdateInput, GrupoMembroInput, GrupoResponsavelInput } from "@/lib/schemas"
import { apiErrorMessage } from "@/lib/api-error"

const QK       = ["grupos"]
const QK_STAFF = ["grupos-staff"]

export type GrupoMembro = {
  membreId: string
  membre:   { id: string; firstName: string; lastName: string; status: string }
}

export type GrupoResponsavel = {
  userId: string
  user:   { id: string; name: string | null; email: string }
}

export type Grupo = {
  id:            string
  nome:          string
  descricao:     string | null
  archivedAt:    string | null
  createdAt:     string
  _count:        { membros: number; chamadas: number }
  responsaveis:  GrupoResponsavel[]
  chamadas:      { data: string }[]
}

export type GrupoDetail = Grupo & {
  membros: GrupoMembro[]
}

export type StaffUser = { id: string; name: string | null; email: string; role: string }

function qkDetail(id: string) { return [...QK, id] }

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur lors du chargement"))
  return res.json()
}

export function useGrupos(params?: { status?: "ativo" | "arquivado"; search?: string }) {
  const search = new URLSearchParams()
  if (params?.status) search.set("status", params.status)
  if (params?.search) search.set("search", params.search)
  const qs = search.toString()
  return useQuery({
    queryKey: [...QK, params ?? {}],
    queryFn:  () => fetchJson<Grupo[]>(`/api/grupos${qs ? `?${qs}` : ""}`),
  })
}

export function useGrupo(id: string | undefined) {
  return useQuery({
    queryKey: qkDetail(id ?? ""),
    queryFn:  () => fetchJson<GrupoDetail>(`/api/grupos/${id}`),
    enabled:  !!id,
  })
}

export function useGrupoStaff() {
  return useQuery({ queryKey: QK_STAFF, queryFn: () => fetchJson<StaffUser[]>("/api/grupos/staff") })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>, id?: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: QK }),
    ...(id ? [qc.invalidateQueries({ queryKey: qkDetail(id) })] : []),
    qc.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
}

async function mutateJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body:    body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
  return res.json()
}

export function useCreateGrupo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: GrupoInput) => mutateJson<Grupo>("/api/grupos", "POST", data),
    onSuccess:  () => invalidateAll(qc),
  })
}

export function useUpdateGrupo(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: GrupoUpdateInput) => mutateJson<Grupo>(`/api/grupos/${id}`, "PATCH", data),
    onSuccess:  () => invalidateAll(qc, id),
  })
}

export function useArchiveGrupo(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (archived: boolean) => mutateJson<Grupo>(`/api/grupos/${id}`, "PATCH", { archived }),
    onSuccess:  () => invalidateAll(qc, id),
  })
}

export function useAddGrupoMembro(grupoId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: GrupoMembroInput) => mutateJson(`/api/grupos/${grupoId}/membros`, "POST", data),
    onSuccess:  () => invalidateAll(qc, grupoId),
  })
}

export function useRemoveGrupoMembro(grupoId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (membreId: string) => mutateJson(`/api/grupos/${grupoId}/membros/${membreId}`, "DELETE"),
    onSuccess:  () => invalidateAll(qc, grupoId),
  })
}

export function useAddGrupoResponsavel(grupoId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: GrupoResponsavelInput) => mutateJson(`/api/grupos/${grupoId}/responsaveis`, "POST", data),
    onSuccess:  () => invalidateAll(qc, grupoId),
  })
}

export function useRemoveGrupoResponsavel(grupoId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => mutateJson(`/api/grupos/${grupoId}/responsaveis/${userId}`, "DELETE"),
    onSuccess:  () => invalidateAll(qc, grupoId),
  })
}
