"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import {
  PlusIcon, IdentificationCardIcon, NotePencilIcon, CopyIcon, ArchiveIcon,
  CloudArrowUpIcon, CloudArrowDownIcon, TrashIcon, LinkIcon,
} from "@phosphor-icons/react/dist/ssr";
import { useCurrentUser } from "@/lib/user-context"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { RowActions } from "@/components/ui/row-actions"
import { BASE_PATH } from "@/lib/env"

type MembershipForm = {
  id:          string
  title:       string
  slug:        string
  status:      "DRAFT" | "PUBLISHED" | "ARCHIVED"
  imageUrl:    string | null
  createdAt:   string
  totalAmount: number
  // Distinct (form, membre) pairs — not a row count, which would overcount a form with a
  // RECURRING tier (one Cotisation per renewal, not per person). See membership-forms/route.ts.
  memberCount: number
  _count:      { cotisations: number }
}

export default function AdhesionsPage() {
  const router  = useRouter()
  const qc      = useQueryClient()
  const t       = useTranslations("membershipForms")
  const tCommon = useTranslations("common")
  const user    = useCurrentUser()

  async function handleCopyFormLink(f: Pick<MembershipForm, "slug">) {
    if (!user.associationSlug) return
    const url = `${window.location.origin}${BASE_PATH}/${user.associationSlug}/adhesion/${f.slug}`
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t("detail.toasts.linkCopied"))
    } catch {
      toast.error(t("detail.toasts.linkCopyError"))
    }
  }

  const [newFormOpen, setNewFormOpen]   = useState(false)
  const [newFormTitle, setNewFormTitle] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<MembershipForm | null>(null)

  const { data: forms = [], isLoading: loadingForms } = useQuery<MembershipForm[]>({
    queryKey:  ["membership-forms"],
    queryFn:   () => fetch("/api/membership-forms").then(r => r.json()),
    staleTime: 0,
  })

  const createFormMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await fetch("/api/membership-forms", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ title }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? t("formsView.toasts.createError"))
      return res.json() as Promise<MembershipForm>
    },
    onSuccess: (form) => {
      qc.invalidateQueries({ queryKey: ["membership-forms"] })
      toast.success(t("formsView.toasts.created"))
      setNewFormOpen(false)
      setNewFormTitle("")
      router.push(`/dashboard/adhesions/${form.id}`)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("formsView.toasts.createError")),
  })

  const publishMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "publish" | "unpublish" | "archive" | "duplicate" }) => {
      const res = await fetch(`/api/membership-forms/${id}/publish`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? t("formsView.toasts.statusError"))
      return res.json() as Promise<MembershipForm>
    },
    onSuccess: (_form, variables) => {
      qc.invalidateQueries({ queryKey: ["membership-forms"] })
      toast.success(variables.action === "duplicate" ? t("formsView.toasts.duplicated") : t("formsView.toasts.statusUpdated"))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("formsView.toasts.statusError")),
  })

  const deleteFormMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/membership-forms/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error((await res.json()).error ?? t("formsView.toasts.deleteError"))
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["membership-forms"] }); toast.success(t("formsView.toasts.deleted")) },
    onError:   (err) => toast.error(err instanceof Error ? err.message : t("formsView.toasts.deleteError")),
  })

  const STATUS_LABEL   = { DRAFT: t("formStatus.draft"), PUBLISHED: t("formStatus.published"), ARCHIVED: t("formStatus.archived") }
  const STATUS_VARIANT: Record<MembershipForm["status"], "secondary" | "default" | "outline"> = {
    DRAFT: "secondary", PUBLISHED: "default", ARCHIVED: "outline",
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        action={
          <Button size="sm" onClick={() => setNewFormOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            {t("newForm")}
          </Button>
        }
      />

      {loadingForms ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card overflow-hidden animate-pulse">
              <div className="aspect-[3/1] bg-muted" />
              <div className="p-4 space-y-2">
                <div className="h-4 w-2/3 rounded bg-muted" />
                <div className="h-3 w-1/3 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : forms.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          {t("formsView.noForms")}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forms.map(f => (
            <div key={f.id} className="group rounded-lg border bg-card overflow-hidden">
              <button
                type="button"
                onClick={() => router.push(`/dashboard/adhesions/${f.id}`)}
                className="block w-full text-left"
              >
                {f.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.imageUrl} alt="" className="aspect-[3/1] w-full object-cover bg-muted" />
                ) : (
                  <div className="aspect-[3/1] w-full bg-muted flex items-center justify-center">
                    <IdentificationCardIcon className="size-6 text-muted-foreground" />
                  </div>
                )}
              </button>
              <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => router.push(`/dashboard/adhesions/${f.id}`)}
                    className="min-w-0 text-left hover:underline decoration-muted-foreground/40 underline-offset-2"
                  >
                    <p className="font-medium truncate">{f.title}</p>
                    <p className="text-xs text-muted-foreground truncate">/{f.slug}</p>
                  </button>
                  <RowActions
                    actions={[
                      { label: t("formsView.actions.edit"), icon: <NotePencilIcon className="size-3.5" />, onClick: () => router.push(`/dashboard/adhesions/${f.id}`) },
                      { label: t("formsView.actions.duplicate"), icon: <CopyIcon className="size-3.5" />, onClick: () => publishMutation.mutate({ id: f.id, action: "duplicate" }) },
                      ...(f.status === "PUBLISHED"
                        ? [{ label: t("detail.copyLinkButton"), icon: <LinkIcon className="size-3.5" />, onClick: () => handleCopyFormLink(f) }]
                        : []),
                      ...(f.status !== "PUBLISHED"
                        ? [{ label: t("formsView.actions.publish"), icon: <CloudArrowUpIcon className="size-3.5" />, onClick: () => publishMutation.mutate({ id: f.id, action: "publish" }) }]
                        : [{ label: t("formsView.actions.unpublish"), icon: <CloudArrowDownIcon className="size-3.5" />, onClick: () => publishMutation.mutate({ id: f.id, action: "unpublish" }) }]),
                      ...(f.status !== "ARCHIVED"
                        ? [{ label: t("formsView.actions.archive"), icon: <ArchiveIcon className="size-3.5" />, onClick: () => publishMutation.mutate({ id: f.id, action: "archive" }) }]
                        : []),
                      {
                        label:       t("formsView.actions.delete"),
                        icon:        <TrashIcon className="size-3.5" />,
                        onClick:     () => setDeleteTarget(f),
                        destructive: true,
                        separator:   true,
                        disabled:    f._count.cotisations > 0,
                      },
                    ]}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Badge variant={STATUS_VARIANT[f.status]}>{STATUS_LABEL[f.status]}</Badge>
                  <span className="text-xs text-muted-foreground">{format(new Date(f.createdAt), "dd/MM/yyyy", { locale: fr })}</span>
                </div>
                <div className="flex items-center justify-between border-t pt-3 text-sm">
                  <span className="text-muted-foreground">{f.memberCount} {t("formsView.columns.members").toLowerCase()}</span>
                  <span className="font-semibold tabular-nums">
                    {f.totalAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={newFormOpen}
        onOpenChange={(o) => { if (!o) { setNewFormOpen(false); setNewFormTitle("") } }}
        title={t("newFormModal.title")}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setNewFormOpen(false)}>{tCommon("cancel")}</Button>
            <Button
              loading={createFormMutation.isPending}
              disabled={!newFormTitle.trim()}
              onClick={() => createFormMutation.mutate(newFormTitle.trim())}
            >
              {t("newFormModal.createButton")}
            </Button>
          </>
        }
      >
        <div className="space-y-2 py-1">
          <Label htmlFor="new-form-title">{t("newFormModal.titleLabel")}</Label>
          <Input
            id="new-form-title"
            value={newFormTitle}
            onChange={(e) => setNewFormTitle(e.target.value)}
            placeholder={t("newFormModal.titlePlaceholder")}
            autoFocus
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}
        title={t("formsView.deleteTitle")}
        description={t("formsView.deleteDescription", { title: deleteTarget?.title ?? "" })}
        confirmLabel={tCommon("delete")}
        loading={deleteFormMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteFormMutation.mutate(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
