"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useLocale, useTranslations } from "next-intl"
import { format } from "date-fns"
import { PlusIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import {
  usePaperFormTemplates, useDeletePaperFormTemplate, type PaperFormTemplate,
} from "@/hooks/use-paper-form-templates"
import { PageHeader } from "@/components/ui/page-header"
import { BackLink } from "@/components/ui/back-link"
import { DataTable, type Column } from "@/components/ui/data-table"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { RowActions } from "@/components/ui/row-actions"
import { Button } from "@/components/ui/button"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"

export const PAPER_FORM_TEMPLATES_PATH = "/dashboard/membres/fiches-papier"

// Fields the import actually reads — "ignore" rows only describe what the form prints.
export function countMappedFields(template: Pick<PaperFormTemplate, "fields">): number {
  return template.fields.filter(field => field.target !== "ignore").length
}

export function PaperFormTemplatesView() {
  const t             = useTranslations("paperFormTemplates")
  const tCommon       = useTranslations("common")
  const router        = useRouter()
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)
  const [deleteTarget, setDeleteTarget] = useState<PaperFormTemplate | null>(null)

  const { data: templates, isLoading } = usePaperFormTemplates()
  const deleteMutation = useDeletePaperFormTemplate()

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

  const columns: Column<PaperFormTemplate>[] = [
    {
      key:    "name",
      header: t("columns.name"),
      cell:   template => <span className="font-medium">{template.name}</span>,
    },
    {
      key:       "pages",
      header:    t("columns.pages"),
      className: "w-24",
      cell:      template => <span className="tabular-nums text-muted-foreground">{template.pagesPerForm}</span>,
    },
    {
      key:       "fields",
      header:    t("columns.fields"),
      className: "w-36",
      cell:      template => (
        <span className="tabular-nums text-muted-foreground">
          {t("mappedFieldCount", { count: countMappedFields(template) })}
        </span>
      ),
    },
    {
      key:        "updatedAt",
      header:     t("columns.updatedAt"),
      className:  "w-36",
      hideInCard: true,
      cell:       template => (
        <span className="text-muted-foreground">
          {format(new Date(template.updatedAt), "d MMM yyyy", { locale: dateFnsLocale })}
        </span>
      ),
    },
    {
      key:       "actions",
      header:    "",
      className: "w-10",
      cell:      template => (
        <RowActions actions={[
          { label: tCommon("edit"),   icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => router.push(`${PAPER_FORM_TEMPLATES_PATH}/${template.id}`) },
          { label: tCommon("delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(template) },
        ]} />
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <BackLink href="/dashboard/membres">{t("backToMembers")}</BackLink>

      <PageHeader
        title={t("title")}
        description={t("description")}
        action={
          <Button size="sm" nativeButton={false} render={<Link href={`${PAPER_FORM_TEMPLATES_PATH}/nouveau`} />}>
            <PlusIcon className="mr-1.5 size-4" />
            {t("newTemplate")}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={templates ?? []}
        loading={isLoading}
        keyExtractor={template => template.id}
        empty={t("empty")}
        onRowClick={template => router.push(`${PAPER_FORM_TEMPLATES_PATH}/${template.id}`)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null) }}
        title={t("deleteConfirm.title", { name: deleteTarget?.name ?? "" })}
        description={t("deleteConfirm.description")}
        confirmLabel={tCommon("delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
