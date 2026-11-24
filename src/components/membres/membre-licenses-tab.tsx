"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SelectField } from "@/components/ui/select-field"
import { FormField } from "@/components/ui/form-field"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useUpdateMembershipLicense, useDeleteMembershipLicense } from "@/hooks/use-membership-licenses"

type LicenseStatus = "A_SOLICITAR" | "EM_ANDAMENTO" | "VALIDADA" | "A_RENOVAR"

type License = {
  id: string
  federation: string
  season: string
  licenseNumber: string | null
  status: LicenseStatus
  declaredByMembre: boolean
  autoRenewed: boolean
  cotisation: { year: number }
}

// Badge treatment mirrors getCotisationStatusBadge's own convention in membre-detail-view.tsx:
// VALIDADA is the only "completed" state (default/success); A_SOLICITAR/A_RENOVAR are plain
// pending states (secondary); EM_ANDAMENTO sits between the two (outline).
const STATUS_VARIANT: Record<LicenseStatus, "default" | "secondary" | "outline"> = {
  A_SOLICITAR: "secondary",
  EM_ANDAMENTO: "outline",
  VALIDADA: "default",
  A_RENOVAR: "secondary",
}
const STATUS_LABEL_KEY: Record<LicenseStatus, string> = {
  A_SOLICITAR: "statusASolicitar",
  EM_ANDAMENTO: "statusEmAndamento",
  VALIDADA: "statusValidada",
  A_RENOVAR: "statusARenovar",
}

// Same take: 50 cap as GET /api/membres/[id]'s `licenses` include — this is purely the
// display-side half of that convention (telling the admin there's more than what's shown),
// not something that paginates further on its own, same as every other tab's own notice.
const TAB_PAGE_SIZE = 50

export function MembreLicensesTab({ membreId, licenses, licensesTotal, canEdit }: {
  membreId: string
  licenses: License[]
  licensesTotal: number
  canEdit: boolean
}) {
  const t = useTranslations("membres.detail.licenses")
  const tDetail = useTranslations("membres.detail")

  if (licenses.length === 0) {
    return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
  }

  return (
    <div className="space-y-2">
      {licenses.map(license => (
        <LicenseRow key={license.id} membreId={membreId} license={license} canEdit={canEdit} />
      ))}
      {licensesTotal > TAB_PAGE_SIZE && (
        <p className="mt-2 text-xs text-muted-foreground">
          {tDetail("showingRecentLicenses", { count: TAB_PAGE_SIZE, total: licensesTotal })}
        </p>
      )}
    </div>
  )
}

function LicenseRow({ membreId, license, canEdit }: { membreId: string; license: License; canEdit: boolean }) {
  const t = useTranslations("membres.detail.licenses")
  const tCommon = useTranslations("common")
  const mutation = useUpdateMembershipLicense(membreId)
  const deleteMutation = useDeleteMembershipLicense(membreId)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const statusOptions = [
    { value: "A_SOLICITAR", label: t("statusASolicitar") },
    { value: "EM_ANDAMENTO", label: t("statusEmAndamento") },
    { value: "VALIDADA", label: t("statusValidada") },
    { value: "A_RENOVAR", label: t("statusARenovar") },
  ]

  // Controlled, not defaultValue: an uncontrolled field never re-syncs after the initial mount,
  // so a failed save left the typed-but-unsaved text sitting there looking saved (no visual
  // revert) once the toast disappeared. dirty guards against a background refetch clobbering
  // an in-progress edit, same pattern as cotisation-defaults-settings.tsx.
  const [numberValue, setNumberValue] = useState(license.licenseNumber ?? "")
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (dirty) return
    setNumberValue(license.licenseNumber ?? "")
  }, [license.licenseNumber, dirty])

  async function handleStatusChange(status: LicenseStatus) {
    try {
      await mutation.mutateAsync({ licenseId: license.id, data: { status } })
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : tCommon("error"))
    }
  }

  async function handleNumberBlur() {
    const trimmed = numberValue.trim()
    if (trimmed === (license.licenseNumber ?? "")) { setDirty(false); return }
    try {
      await mutation.mutateAsync({ licenseId: license.id, data: { licenseNumber: trimmed || null } })
      setDirty(false)
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : tCommon("error"))
      // Revert visually — the save failed, so the field must not go on looking like it holds
      // a saved value it doesn't.
      setNumberValue(license.licenseNumber ?? "")
      setDirty(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">{license.federation} — {license.season}</p>
          <p className="text-xs text-muted-foreground">
            {t("seasonYear", { year: license.cotisation.year })}
            {license.autoRenewed && ` · ${t("autoRenewed")}`}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[license.status]}>{t(STATUS_LABEL_KEY[license.status])}</Badge>
      </div>
      {license.declaredByMembre && license.status === "EM_ANDAMENTO" && (
        <p className="mt-1.5 text-xs text-muted-foreground">{t("declaredByMembreNotice")}</p>
      )}
      {canEdit && (
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="flex items-end gap-3">
            <div className="w-44">
              <SelectField
                label={t("statusField")}
                options={statusOptions}
                value={license.status}
                onValueChange={v => handleStatusChange(v as LicenseStatus)}
              />
            </div>
            <div className="w-44">
              <FormField
                label={t("licenseNumberField")}
                value={numberValue}
                onChange={e => { setNumberValue(e.target.value); setDirty(true) }}
                onBlur={handleNumberBlur}
              />
            </div>
          </div>
          {/* VALIDADA has no delete button at all, not just a disabled one — the club already
              confirmed this with the federation, same reasoning as the server-side guard. */}
          {license.status !== "VALIDADA" && (
            <Button type="button" variant="ghost" size="icon" onClick={() => setDeleteOpen(true)} aria-label={tCommon("delete")}>
              <TrashIcon className="size-4" />
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("deleteConfirmTitle")}
        description={t("deleteConfirmDescription", { federation: license.federation, season: license.season })}
        confirmLabel={tCommon("delete")}
        loading={deleteMutation.isPending}
        onConfirm={async () => {
          await deleteMutation.mutateAsync(license.id)
          setDeleteOpen(false)
        }}
      />
    </div>
  )
}
