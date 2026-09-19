import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { AssociationDocumentInput, AssociationDocumentUpdateInput } from "@/lib/schemas"
import { apiError } from "@/lib/api-error"
import { portalFetch } from "@/lib/portal-fetch"

const QK        = ["association-documents"]
const PORTAL_QK = ["portal", "association-documents"]

// ─── Types ──────────────────────────────────────────────────────────────────

export type AssociationDocumentSummary = {
  id:                 string
  title:              string
  visibleToMembers:   boolean
  visibleToPublic:    boolean
  requiresAcceptance: boolean
  createdAt:          string
  updatedAt:          string
}

export type AssociationDocument = AssociationDocumentSummary & {
  content: string
}

export type PortalAssociationDocumentSummary = {
  id:        string
  title:     string
  updatedAt: string
}

export type PortalAssociationDocument = PortalAssociationDocumentSummary & {
  content: string
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

async function fetchAssociationDocuments(): Promise<AssociationDocumentSummary[]> {
  const res = await fetch("/api/association-documents")
  if (!res.ok) throw await apiError(res, "Erreur lors du chargement des documents")
  return res.json()
}

async function fetchAssociationDocument(id: string): Promise<AssociationDocument> {
  const res = await fetch(`/api/association-documents/${id}`)
  if (!res.ok) throw await apiError(res, "Erreur lors du chargement du document")
  return res.json()
}

async function createAssociationDocument(data: AssociationDocumentInput): Promise<AssociationDocument> {
  const res = await fetch("/api/association-documents", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la création")
  return res.json()
}

async function updateAssociationDocument(id: string, data: AssociationDocumentUpdateInput): Promise<AssociationDocument> {
  const res = await fetch(`/api/association-documents/${id}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) throw await apiError(res, "Erreur lors de la mise à jour")
  return res.json()
}

async function deleteAssociationDocument(id: string) {
  const res = await fetch(`/api/association-documents/${id}`, { method: "DELETE" })
  if (!res.ok) throw await apiError(res, "Erreur lors de la suppression")
}

export function useAssociationDocuments() {
  return useQuery({
    queryKey:  QK,
    queryFn:   fetchAssociationDocuments,
    staleTime: 0,
  })
}

// `refetchOnWindowFocus` is opt-out for the editor: a background refetch there only risks
// replacing the document under unsaved edits, and saves already refresh the cache.
export function useAssociationDocument(id: string, options?: { refetchOnWindowFocus?: boolean }) {
  return useQuery({
    queryKey: [...QK, "detail", id],
    queryFn:  () => fetchAssociationDocument(id),
    enabled:  !!id,
    ...(options?.refetchOnWindowFocus !== undefined ? { refetchOnWindowFocus: options.refetchOnWindowFocus } : {}),
  })
}

// Invalidating QK also covers every [...QK, "detail", id] entry (prefix match). The portal
// keys are included too so a manager previewing the member portal in the same tab sees a
// visibility or content change without a reload.
function invalidateAll(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: QK }),
    queryClient.invalidateQueries({ queryKey: PORTAL_QK }),
    queryClient.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
}

export function useCreateAssociationDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: createAssociationDocument,
    onSuccess:  () => invalidateAll(queryClient),
  })
}

export function useUpdateAssociationDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: AssociationDocumentUpdateInput }) => updateAssociationDocument(id, data),
    onSuccess:  () => invalidateAll(queryClient),
  })
}

export function useDeleteAssociationDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteAssociationDocument,
    onSuccess:  (_result, id) => {
      // Dropped rather than invalidated — refetching a just-deleted document would only 404.
      queryClient.removeQueries({ queryKey: [...QK, "detail", id] })
      return invalidateAll(queryClient)
    },
  })
}

// ─── Portal ─────────────────────────────────────────────────────────────────

export function usePortalAssociationDocuments() {
  return useQuery({
    queryKey: PORTAL_QK,
    queryFn:  () => portalFetch("/api/portal/association-documents") as Promise<PortalAssociationDocumentSummary[]>,
  })
}

export function usePortalAssociationDocument(id: string) {
  return useQuery({
    queryKey: [...PORTAL_QK, id],
    queryFn:  () => portalFetch(`/api/portal/association-documents/${id}`) as Promise<PortalAssociationDocument>,
    enabled:  !!id,
  })
}
