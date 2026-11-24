import { useMutation, useQueryClient } from "@tanstack/react-query"

export type MembershipLicenseUpdateInput = {
  status?: "A_SOLICITAR" | "EM_ANDAMENTO" | "VALIDADA" | "A_RENOVAR"
  licenseNumber?: string | null
}

async function updateMembershipLicense(membreId: string, licenseId: string, data: MembershipLicenseUpdateInput) {
  const res = await fetch(`/api/membres/${membreId}/licenses/${licenseId}`, {
    method:  "PATCH",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(typeof body?.error === "string" ? body.error : undefined)
  }
  return res.json()
}

// Invalidates the membre detail query (["membres", "detail", membreId]) — same query key as
// useMembre in use-membres.ts — so the Licenças tab reflects the edit immediately.
export function useUpdateMembershipLicense(membreId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ licenseId, data }: { licenseId: string; data: MembershipLicenseUpdateInput }) =>
      updateMembershipLicense(membreId, licenseId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["membres", "detail", membreId] }),
  })
}

async function deleteMembershipLicense(membreId: string, licenseId: string) {
  const res = await fetch(`/api/membres/${membreId}/licenses/${licenseId}`, { method: "DELETE" })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(typeof body?.error === "string" ? body.error : undefined)
  }
}

export function useDeleteMembershipLicense(membreId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (licenseId: string) => deleteMembershipLicense(membreId, licenseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["membres", "detail", membreId] }),
  })
}
