"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { toast } from "sonner"
import {
  useMembreDuplicateDetail, useMergeMembreDuplicate, useSetMembreDuplicateStatus,
} from "@/hooks/use-membre-duplicates"
import { MERGEABLE_MEMBRE_FIELDS, type FieldResolutions, type MergeableMembreField } from "@/lib/membre-merge-fields"
import type { MembreDuplicateFullMembre } from "@/lib/schemas"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Skeleton } from "@/components/ui/skeleton"

function fieldValue(membre: MembreDuplicateFullMembre, field: MergeableMembreField): unknown {
  return membre[field]
}

// Mirrors GROUPE_SANGUIN_LABELS in src/app/api/membres/export/route.ts — duplicated rather
// than imported since that file is server-only (CSV export) and this is a client component.
const GROUPE_SANGUIN_LABELS: Record<string, string> = {
  A_POSITIF: "A+", A_NEGATIF: "A-", B_POSITIF: "B+", B_NEGATIF: "B-",
  AB_POSITIF: "AB+", AB_NEGATIF: "AB-", O_POSITIF: "O+", O_NEGATIF: "O-",
}

function formatValue(value: unknown, t: ReturnType<typeof useTranslations>): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no")
  if (value instanceof Date) return format(value, "dd/MM/yyyy")
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return format(date, "dd/MM/yyyy")
  }
  return String(value)
}

// A handful of fields store a code (an id, or an enum value) that isn't meant for display as-
// is — showing a raw typeId or "A_POSITIF" in an admin-facing compare table would be exactly
// the kind of technical leakage the rest of the app already avoids (see membre-detail-view.tsx
// resolving the same civilite/sexe enums through these same translation keys).
function formatFieldValue(field: MergeableMembreField, membre: MembreDuplicateFullMembre, t: ReturnType<typeof useTranslations>): string {
  const value = fieldValue(membre, field)
  if (field === "typeId") return membre.type?.name ?? "—"
  if (field === "civilite" && typeof value === "string") return t(`membres.form.civilite.${value.toLowerCase()}`)
  if (field === "sexe" && typeof value === "string") return t(`membres.form.sexe.${value.toLowerCase()}`)
  if (field === "groupeSanguin" && typeof value === "string") return GROUPE_SANGUIN_LABELS[value] ?? value
  return formatValue(value, t)
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const normalize = (v: unknown) => (v === null || v === undefined || v === "" ? null : v instanceof Date ? v.toISOString() : v)
  return normalize(a) === normalize(b)
}

export function MembreDuplicateMergeView({ apiBasePath, matchId, backHref }: {
  apiBasePath: string
  matchId: string
  backHref: string
}) {
  const t = useTranslations("membreDuplicates.merge")
  const router = useRouter()
  const { data: detail, isLoading } = useMembreDuplicateDetail(apiBasePath, matchId)

  const [primaryId, setPrimaryId] = useState<string | null>(null)
  const [fieldResolutions, setFieldResolutions] = useState<FieldResolutions>({})
  const [confirmOpen, setConfirmOpen] = useState(false)

  const merge = useMergeMembreDuplicate(apiBasePath, matchId)
  const dismiss = useSetMembreDuplicateStatus(apiBasePath, matchId)

  const resolvedPrimaryId = primaryId ?? detail?.membreA.id ?? null
  const primary   = detail && resolvedPrimaryId === detail.membreB.id ? detail.membreB : detail?.membreA
  const secondary = detail && resolvedPrimaryId === detail.membreB.id ? detail.membreA : detail?.membreB

  const differingFields = useMemo(() => {
    if (!primary || !secondary) return []
    return MERGEABLE_MEMBRE_FIELDS.filter(field => !valuesEqual(fieldValue(primary, field), fieldValue(secondary, field)))
  }, [primary, secondary])

  const relationLabels: Record<string, string> = {
    cotisations: t("relations.cotisations"), participations: t("relations.participations"),
    dons: t("relations.dons"), membershipAddonPurchases: t("relations.membershipAddonPurchases"),
    automationLogs: t("relations.automationLogs"), emailMessages: t("relations.emailMessages"),
    smsMessages: t("relations.smsMessages"), incomes: t("relations.incomes"),
    materialLoans: t("relations.materialLoans"), boutiqueCommandes: t("relations.boutiqueCommandes"),
    actualiteRecipients: t("relations.actualiteRecipients"), sondageRecipients: t("relations.sondageRecipients"),
    sondageReponses: t("relations.sondageReponses"), meetingParticipants: t("relations.meetingParticipants"),
    erasureRequests: t("relations.erasureRequests"), dependants: t("relations.dependants"),
    cotisationSubscription: t("relations.cotisationSubscription"), controlAlert: t("relations.controlAlert"),
  }

  const relatedDataRows = useMemo(() => {
    if (!detail) return []
    return Object.entries(relationLabels)
      .map(([key, label]) => {
        const countPrimary = (resolvedPrimaryId === detail.membreA.id ? detail.relationCounts.membreA : detail.relationCounts.membreB)[key] ?? 0
        const countSecondary = (resolvedPrimaryId === detail.membreA.id ? detail.relationCounts.membreB : detail.relationCounts.membreA)[key] ?? 0
        return { key, label, countPrimary, countSecondary }
      })
      .filter(row => row.countPrimary > 0 || row.countSecondary > 0)
    // relationLabels is rebuilt every render (depends on `t`), its content is stable — only
    // the values actually driving the computation belong in the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, resolvedPrimaryId])

  const bothHavePortalAccounts = !!primary?.userId && !!secondary?.userId
  const secondaryAdoptsAccount = !primary?.userId && !!secondary?.userId

  async function handleMerge() {
    if (!secondary) return
    try {
      const result = await merge.mutateAsync({ primaryMembreId: resolvedPrimaryId!, fieldResolutions })
      toast.success(t("mergeSuccess", { count: Object.values(result.relationCounts).reduce((a, b) => a + b, 0) }))
      router.push(backHref)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("mergeError"))
    } finally {
      setConfirmOpen(false)
    }
  }

  async function handleDismiss() {
    try {
      await dismiss.mutateAsync("DISMISSED")
      router.push(backHref)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("mergeError"))
    }
  }

  if (isLoading || !detail || !primary || !secondary) {
    return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>
  }

  const alreadyMerged = detail.status === "MERGED"

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Button variant="ghost" size="sm" onClick={() => router.push(backHref)} className="-ml-2">{t("backLink")}</Button>
        <h2 className="text-xl font-semibold tracking-tight">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {alreadyMerged ? (
        <p className="text-sm text-muted-foreground">{t("alreadyMerged")}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 sm:divide-x sm:divide-border">
            {[detail.membreA, detail.membreB].map(membre => (
              <label key={membre.id} className="flex items-start gap-3 pb-4 sm:pl-6 sm:first:pl-0">
                <input
                  type="radio"
                  name="primary"
                  checked={resolvedPrimaryId === membre.id}
                  onChange={() => setPrimaryId(membre.id)}
                  className="mt-1"
                />
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{t("keepAsPrimary")}</p>
                  <p className="font-medium">{membre.firstName} {membre.lastName}</p>
                  {membre.email && <p className="text-xs text-muted-foreground">{membre.email}</p>}
                  {membre.phone && <p className="text-xs text-muted-foreground">{membre.phone}</p>}
                </div>
              </label>
            ))}
          </div>

          {differingFields.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium">{t("fieldsTitle")}</h3>
              <div className="divide-y divide-border rounded-lg border">
                {differingFields.map(field => {
                  const primaryVal = formatFieldValue(field, primary, t)
                  const secondaryVal = formatFieldValue(field, secondary, t)
                  const resolution = fieldResolutions[field] ?? "PRIMARY"
                  return (
                    <div key={field} className="grid grid-cols-1 gap-2 px-4 py-2.5 sm:grid-cols-[1fr_1fr_1fr] sm:items-center">
                      <p className="text-sm text-muted-foreground">{t(`fields.${field}`)}</p>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio" name={`field-${field}`} checked={resolution === "PRIMARY"}
                          onChange={() => setFieldResolutions(prev => ({ ...prev, [field]: "PRIMARY" }))}
                        />
                        {primaryVal}
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio" name={`field-${field}`} checked={resolution === "SECONDARY"}
                          onChange={() => setFieldResolutions(prev => ({ ...prev, [field]: "SECONDARY" }))}
                        />
                        {secondaryVal}
                      </label>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h3 className="text-sm font-medium">{t("relatedDataTitle")}</h3>
            {relatedDataRows.length > 0 ? (
              <div className="divide-y divide-border rounded-lg border">
                {relatedDataRows.map(({ key, label, countPrimary, countSecondary }) => (
                  <div key={key} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-muted-foreground">{label}</span>
                    <span>{t("relatedDataCounts", { primary: countPrimary, secondary: countSecondary })}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("relatedDataEmpty")}</p>
            )}
            {detail.potentialConflicts.length > 0 && (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {detail.potentialConflicts.map((conflict, i) => (
                  <li key={i}>{t("conflictWarning", { reason: conflict.reason })}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t pt-4">
            <Button variant="ghost" onClick={handleDismiss} disabled={dismiss.isPending}>{t("dismissAction")}</Button>
            <Button onClick={() => setConfirmOpen(true)}>{t("mergeAction")}</Button>
          </div>

          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={t("mergeConfirmTitle")}
            description={bothHavePortalAccounts ? t("mergeConfirmDescriptionWithPortalWarning") : secondaryAdoptsAccount ? t("mergeConfirmDescriptionAdoptsPortal") : t("mergeConfirmDescription")}
            confirmLabel={t("mergeAction")}
            confirmVariant="default"
            loading={merge.isPending}
            onConfirm={handleMerge}
          />
        </>
      )}
    </div>
  )
}
