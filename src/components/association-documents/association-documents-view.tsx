"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { format } from "date-fns"
import { PlusIcon, PencilSimpleIcon, TrashIcon, DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr"
import {
  useAssociationDocuments, useUpdateAssociationDocument, useDeleteAssociationDocument,
  type AssociationDocumentSummary,
} from "@/hooks/use-association-documents"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { RowActions } from "@/components/ui/row-actions"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { BASE_PATH } from "@/lib/env"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"

const ASSOCIATION_DOCUMENTS_PATH = "/dashboard/documents-association"

export function AssociationDocumentsView() {
  const t             = useTranslations("associationDocuments")
  const tCommon       = useTranslations("common")
  const router        = useRouter()
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)
  const [deleteTarget, setDeleteTarget] = useState<AssociationDocumentSummary | null>(null)
  // One entry per toggle still in flight — the mutation's own `variables` only reflects the
  // latest call, so toggling A then B would otherwise re-enable A while its PATCH runs.
  const [pendingVisibilityIds, setPendingVisibilityIds] = useState<Set<string>>(() => new Set())

  const { data: documents, isLoading } = useAssociationDocuments()
  const updateMutation = useUpdateAssociationDocument()
  const deleteMutation = useDeleteAssociationDocument()

  async function handleVisibilityChange(document: AssociationDocumentSummary, visibleToMembers: boolean) {
    setPendingVisibilityIds(previousIds => new Set(previousIds).add(document.id))
    try {
      await updateMutation.mutateAsync({ id: document.id, data: { visibleToMembers } })
      toast.success(visibleToMembers
        ? t("toasts.madeVisible", { title: document.title })
        : t("toasts.madeHidden", { title: document.title }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tCommon("genericError"))
    } finally {
      setPendingVisibilityIds(previousIds => {
        const nextIds = new Set(previousIds)
        nextIds.delete(document.id)
        return nextIds
      })
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success(t("toasts.deleted"))
      setDeleteTarget(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tCommon("genericError"))
    }
  }

  const columns: Column<AssociationDocumentSummary>[] = [
    {
      key:    "title",
      header: t("columns.title"),
      cell:   document => <span className="font-medium">{document.title}</span>,
    },
    {
      key:       "visibility",
      header:    t("columns.visibility"),
      className: "w-40",
      cell:      document => (
        // Toggling visibility must not also open the document through the row click.
        <div className="flex items-center gap-2" onClick={event => event.stopPropagation()}>
          <Switch
            checked={document.visibleToMembers}
            aria-label={`${t("visibleToMembers")} – ${document.title}`}
            disabled={pendingVisibilityIds.has(document.id)}
            onCheckedChange={checked => handleVisibilityChange(document, checked)}
          />
          {/* The switch drives the portal visibility only; public publication is set in the
              editor, so it shows here as plain text rather than a second control per row. */}
          <span className="text-xs text-muted-foreground">
            {document.visibleToMembers ? t("visible") : t("hidden")}
            {document.visibleToPublic ? ` · ${t("publicShort")}` : ""}
          </span>
        </div>
      ),
    },
    {
      key:        "updatedAt",
      header:     t("columns.updatedAt"),
      className:  "w-36",
      hideInCard: true,
      cell:       document => (
        <span className="text-muted-foreground">
          {format(new Date(document.updatedAt), "d MMM yyyy", { locale: dateFnsLocale })}
        </span>
      ),
    },
    {
      key:       "actions",
      header:    "",
      className: "w-10",
      cell:      document => (
        <RowActions actions={[
          { label: tCommon("edit"),   icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => router.push(`${ASSOCIATION_DOCUMENTS_PATH}/${document.id}`) },
          // Only offered where there is something to export: a document nobody has to accept
          // has no acceptances behind it.
          ...(document.requiresAcceptance
            ? [{ label: t("exportAcceptances"), icon: <DownloadSimpleIcon className="size-3.5" />, onClick: () => { window.location.href = `${BASE_PATH}/api/legal/acceptances?documentId=${document.id}` } }]
            : []),
          { label: tCommon("delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(document) },
        ]} />
      ),
    },
  ]

  const documentCount = documents?.length ?? 0
  const visibleCount  = documents?.filter(document => document.visibleToMembers).length ?? 0
  // Always rendered, counting 0 while loading — same as fournisseurs-view — so the header
  // never gains a line once the list arrives.
  const description   = documentCount > 0
    ? `${t("count", { count: documentCount })} · ${t("visibleCount", { visible: visibleCount })}`
    : t("count", { count: documentCount })

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={description}
        action={
          <Button size="sm" nativeButton={false} render={<Link href={`${ASSOCIATION_DOCUMENTS_PATH}/nouveau`} />}>
            <PlusIcon className="mr-1.5 size-4" />
            {tCommon("add")}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={documents ?? []}
        loading={isLoading}
        keyExtractor={document => document.id}
        empty={t("empty")}
        onRowClick={document => router.push(`${ASSOCIATION_DOCUMENTS_PATH}/${document.id}`)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        title={t("deleteConfirm.title", { title: deleteTarget?.title ?? "" })}
        description={t("deleteConfirm.description")}
        confirmLabel={tCommon("delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
