"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, TrashIcon, EyeIcon } from "@phosphor-icons/react/dist/ssr"
import { useImmobilisations, useCreateImmobilisation, useDeleteImmobilisation } from "@/hooks/use-immobilisations"
import type { ImmobilisationInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { RowActions } from "@/components/ui/row-actions"
import { ImmobilisationForm } from "@/components/finances/immobilisation-form"
import { useHasAccess } from "@/lib/user-context"

type Depreciation = {
  id:               string
  dotationAmount:   string
  accumulatedAfter: string
  netValueAfter:    string
  exercice:         { id: string; label: string }
}

type Immobilisation = {
  id:               string
  label:            string
  entryValue:       string
  usageStartDate:   string
  depreciations:    Depreciation[]
}

export function ImmobilisationsView() {
  const t = useTranslations()
  const canEditComptabilite = useHasAccess("comptabilite", "edit")
  const [createOpen, setCreateOpen]     = useState(false)
  const [detailTarget, setDetailTarget] = useState<Immobilisation | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Immobilisation | null>(null)

  const { data: immobilisations = [], isLoading } = useImmobilisations()
  const createMutation = useCreateImmobilisation()
  const deleteMutation = useDeleteImmobilisation()

  const fmt = (n: string | number) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  async function handleCreate(data: ImmobilisationInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success(t("finances.immobilisationsView.toasts.created"))
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success(t("finances.immobilisationsView.toasts.deleted"))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  function latestAccumulated(asset: Immobilisation): number {
    if (asset.depreciations.length === 0) return 0
    return Number(asset.depreciations[asset.depreciations.length - 1].accumulatedAfter)
  }

  const columns: Column<Immobilisation>[] = [
    {
      key: "label",
      header: t("finances.immobilisationsView.columns.label"),
      cell: (a) => <p className="font-medium">{a.label}</p>,
    },
    {
      key: "entryValue",
      header: t("finances.immobilisationsView.columns.entryValue"),
      className: "w-32 text-right",
      cell: (a) => <span className="tabular-nums">{fmt(a.entryValue)}</span>,
    },
    {
      key: "accumulated",
      header: t("finances.immobilisationsView.columns.accumulated"),
      className: "w-32 text-right",
      cell: (a) => <span className="tabular-nums text-muted-foreground">{fmt(latestAccumulated(a))}</span>,
    },
    {
      key: "netValue",
      header: t("finances.immobilisationsView.columns.netValue"),
      className: "w-32 text-right",
      cell: (a) => <span className="font-semibold tabular-nums">{fmt(Number(a.entryValue) - latestAccumulated(a))}</span>,
    },
    {
      key: "usageStartDate",
      header: t("finances.immobilisationsView.columns.usageStartDate"),
      className: "w-28",
      cell: (a) => new Date(a.usageStartDate).toLocaleDateString("fr-FR", { timeZone: "UTC" }),
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (a) => (
        <RowActions actions={[
          { label: t("common.view"), icon: <EyeIcon className="size-3.5" />, onClick: () => setDetailTarget(a) },
          ...(canEditComptabilite ? [
            { label: t("common.delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(a) },
          ] : []),
        ]} />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("finances.immobilisationsView.title")}
        description={t("finances.immobilisationsView.description")}
        action={canEditComptabilite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            {t("finances.immobilisationsView.add")}
          </Button>
        )}
      />

      <DataTable
        columns={columns}
        data={immobilisations as Immobilisation[]}
        loading={isLoading}
        keyExtractor={(a) => a.id}
        empty={t("finances.immobilisationsView.noImmobilisations")}
      />

      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t("finances.immobilisationsView.newTitle")} size="md" dismissable={false}>
        <ImmobilisationForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} loading={createMutation.isPending} />
      </Modal>

      <Modal open={!!detailTarget} onOpenChange={(o) => !o && setDetailTarget(null)} title={detailTarget?.label ?? ""} size="md">
        <div className="space-y-3">
          <h4 className="text-sm font-medium">{t("finances.immobilisationsView.drillDown.title")}</h4>
          {detailTarget && detailTarget.depreciations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("finances.immobilisationsView.drillDown.noDepreciations")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-1 text-left">{t("finances.immobilisationsView.drillDown.exercice")}</th>
                  <th className="py-1 text-right">{t("finances.immobilisationsView.drillDown.dotation")}</th>
                  <th className="py-1 text-right">{t("finances.immobilisationsView.drillDown.accumulated")}</th>
                  <th className="py-1 text-right">{t("finances.immobilisationsView.drillDown.netValue")}</th>
                </tr>
              </thead>
              <tbody>
                {detailTarget?.depreciations.map(d => (
                  <tr key={d.id} className="border-b last:border-0">
                    <td className="py-1.5">{d.exercice.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(d.dotationAmount)}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmt(d.accumulatedAfter)}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums">{fmt(d.netValueAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("finances.immobilisationsView.deleteConfirmTitle")}
        description={deleteTarget?.label ?? ""}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
