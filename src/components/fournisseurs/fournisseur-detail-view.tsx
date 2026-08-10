"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useInfiniteQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import {
  PencilSimpleIcon, ArchiveIcon, FileTextIcon, ReceiptIcon,
  PaperclipIcon, EnvelopeSimpleIcon, PhoneIcon, MapPinIcon,
  GlobeIcon, TrashIcon, ArrowSquareOutIcon,
} from "@phosphor-icons/react/dist/ssr";
import { useFournisseur, useUpdateFournisseur, useDeleteFournisseur, useFournisseurPaiements } from "@/hooks/use-fournisseurs"
import { useDevisPaginated, useCreateDevis } from "@/hooks/use-devis"
import { useFacturesPaginated, useCreateFacture } from "@/hooks/use-factures"
import { useFacturesRecuesPaginated, useCreateFactureRecue, useDeleteFactureRecue } from "@/hooks/use-factures-recues"
import type { DevisInput, FactureInput, FactureRecueInput, FournisseurInput } from "@/lib/schemas"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { FournisseurForm } from "@/components/fournisseurs/fournisseur-form"
import { DevisForm } from "@/components/devis/devis-form"
import { FactureForm } from "@/components/factures/facture-form"
import { FactureRecueForm } from "@/components/fournisseurs/facture-recue-form"
import { RowActions } from "@/components/ui/row-actions"
import { ActivityLogList, type ActivityLogEntry } from "@/components/ui/activity-log-list"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { useModules } from "@/lib/user-context"

type Translator = ReturnType<typeof useTranslations>

function getFournisseurStatusBadge(t: Translator): Record<string, { label: string; variant: "default" | "secondary" | "outline" }> {
  return {
    ACTIF:   { label: t("fournisseurs.form.status.actif"),   variant: "default"   },
    INACTIF: { label: t("fournisseurs.form.status.inactif"), variant: "secondary" },
    ARCHIVE: { label: t("fournisseurs.view.status.archive"), variant: "outline"   },
  }
}

function getDevisStatusBadge(t: Translator): Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> {
  return {
    BROUILLON: { label: t("devis.form.status.brouillon"), variant: "secondary"   },
    ENVOYE:    { label: t("devis.form.status.envoye"),    variant: "outline"     },
    ACCEPTE:   { label: t("devis.form.status.accepte"),   variant: "default"     },
    REFUSE:    { label: t("devis.form.status.refuse"),    variant: "destructive" },
    EXPIRE:    { label: t("devis.form.status.expire"),    variant: "outline"     },
  }
}

function getFactureStatusBadge(t: Translator): Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> {
  return {
    BROUILLON:           { label: t("factures.form.status.brouillon"),          variant: "secondary"   },
    EN_ATTENTE:          { label: t("factures.form.status.enAttente"),          variant: "outline"     },
    PARTIELLEMENT_PAYEE: { label: t("factures.form.status.partiellementPayee"), variant: "outline"     },
    PAYEE:               { label: t("factures.form.status.payee"),              variant: "default"    },
    EN_RETARD:           { label: t("factures.view.status.enRetard"),           variant: "destructive" },
    ANNULEE:             { label: t("factures.form.status.annulee"),            variant: "secondary"  },
  }
}

function getDocumentTypeLabels(t: Translator): Record<string, string> {
  return {
    facture:     t("fournisseurs.detail.documentTypes.facture"),
    devis_recu:  t("fournisseurs.detail.documentTypes.devisRecu"),
    comprovante: t("fournisseurs.detail.documentTypes.comprovante"),
    contrat:     t("fournisseurs.detail.documentTypes.contrat"),
    autre:       t("fournisseurs.detail.documentTypes.autre"),
  }
}

const fmt = (n: number | string) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

export function FournisseurDetailView() {
  const t = useTranslations()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const modules = useModules()

  const [editOpen, setEditOpen]           = useState(false)
  const [archiveOpen, setArchiveOpen]     = useState(false)
  const [createDevisOpen, setCreateDevisOpen]     = useState(false)
  const [createFactureOpen, setCreateFactureOpen] = useState(false)
  const [createDocOpen, setCreateDocOpen] = useState(false)
  const [deleteDocTarget, setDeleteDocTarget] = useState<{ id: string; label: string; payee: boolean } | null>(null)

  const { data: fournisseur, isLoading, isError } = useFournisseur(id)
  const TAB_PAGE_SIZE = 50
  const { data: devisResult }   = useDevisPaginated(1, TAB_PAGE_SIZE, undefined, undefined, id)
  const { data: facturesResult } = useFacturesPaginated(1, TAB_PAGE_SIZE, undefined, undefined, id)
  const { data: documentsResult } = useFacturesRecuesPaginated(1, TAB_PAGE_SIZE, id)
  const documents = documentsResult?.data ?? []
  const { data: payments = [] } = useFournisseurPaiements(modules.factures ? id : "")

  // Aggregates FOURNISSEUR_* logs with everything logged against this fournisseur's own
  // Devis/Facture/FactureRecue (see fournisseurId handling in /api/activity-logs) — a
  // fournisseur's history should show what happened around it, not just edits to the
  // contact card itself. Paginated via useInfiniteQuery (same pattern as
  // membre-activity-log.tsx) since the backend caps each page at 50 entries — a fournisseur
  // with a long history used to silently lose everything past the first 50 with no "load
  // more" affordance.
  const {
    data: logsData, fetchNextPage: fetchMoreLogs, hasNextPage: hasMoreLogs, isFetchingNextPage: loadingMoreLogs,
  } = useInfiniteQuery<{ data: ActivityLogEntry[]; total: number; page: number; totalPages: number }>({
    queryKey:        ["activity-logs", "fournisseur-aggregate", id],
    initialPageParam: 1,
    queryFn:  ({ pageParam }) => fetch(`/api/activity-logs?fournisseurId=${id}&page=${pageParam}`).then(r => r.json()),
    getNextPageParam: (last) => last.page < last.totalPages ? last.page + 1 : undefined,
    enabled:  !!id,
  })
  const logs      = logsData?.pages.flatMap(p => p.data) ?? []
  const logsTotal = logsData?.pages[0]?.total ?? 0

  const updateMutation     = useUpdateFournisseur(id)
  const archiveMutation    = useDeleteFournisseur()
  const createDevisMutation    = useCreateDevis()
  const createFactureMutation  = useCreateFacture()
  const createDocMutation      = useCreateFactureRecue()
  const deleteDocMutation      = useDeleteFactureRecue()

  async function handleUpdate(data: FournisseurInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t("fournisseurs.detail.toasts.updated"))
      setEditOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleArchive() {
    try {
      await archiveMutation.mutateAsync(id)
      toast.success(t("fournisseurs.detail.toasts.archived"))
      router.push("/dashboard/fournisseurs")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleCreateDevis(data: DevisInput) {
    try {
      await createDevisMutation.mutateAsync({ ...data, fournisseurId: id })
      toast.success(t("fournisseurs.detail.toasts.devisCreated"))
      setCreateDevisOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleCreateFacture(data: FactureInput) {
    try {
      await createFactureMutation.mutateAsync({ ...data, fournisseurId: id })
      toast.success(t("fournisseurs.detail.toasts.factureCreated"))
      setCreateFactureOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleCreateDoc(data: FactureRecueInput) {
    try {
      await createDocMutation.mutateAsync({ ...data, fournisseurId: id })
      toast.success(t("fournisseurs.detail.toasts.documentAdded"))
      setCreateDocOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDeleteDoc() {
    if (!deleteDocTarget) return
    try {
      await deleteDocMutation.mutateAsync(deleteDocTarget.id)
      toast.success(t("fournisseurs.detail.toasts.documentDeleted"))
      setDeleteDocTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  if (isLoading) {
    return <DetailLoadingSkeleton />
  }

  if (isError || !fournisseur) {
    return (
      <DetailNotFound
        message={t("fournisseurs.detail.notFound")}
        backHref="/dashboard/fournisseurs"
        backLabel={t("fournisseurs.detail.backToList")}
      />
    )
  }

  const fournisseurStatusBadge = getFournisseurStatusBadge(t)
  const devisStatusBadge       = getDevisStatusBadge(t)
  const factureStatusBadge     = getFactureStatusBadge(t)
  const documentTypeLabel      = getDocumentTypeLabels(t)
  const statusInfo = fournisseurStatusBadge[fournisseur.status]

  return (
    <div className="space-y-4 mt-4">
      <div className="space-y-3">
        <BackLink href="/dashboard/fournisseurs">{t("fournisseurs.detail.backLink")}</BackLink>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{fournisseur.companyName}</h1>
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
            </div>
            {fournisseur.category && <p className="text-sm text-muted-foreground">{fournisseur.category}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {modules.devis && (
              <Button size="sm" variant="outline" onClick={() => setCreateDevisOpen(true)}>
                <FileTextIcon className="mr-1.5 size-4" />
                {t("fournisseurs.detail.devisButton")}
              </Button>
            )}
            {modules.factures && (
              <Button size="sm" variant="outline" onClick={() => setCreateFactureOpen(true)}>
                <ReceiptIcon className="mr-1.5 size-4" />
                {t("fournisseurs.detail.factureButton")}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setCreateDocOpen(true)}>
              <PaperclipIcon className="mr-1.5 size-4" />
              {t("fournisseurs.detail.documentButton")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <PencilSimpleIcon className="mr-1.5 size-4" />
              {t("common.edit")}
            </Button>
            {fournisseur.status !== "ARCHIVE" && (
              <Button size="sm" variant="outline" onClick={() => setArchiveOpen(true)}>
                <ArchiveIcon className="mr-1.5 size-4" />
                {t("fournisseurs.view.actions.archive")}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("fournisseurs.detail.contact")}</p>
          {fournisseur.contactName && <p className="font-medium">{fournisseur.contactName}{fournisseur.contactRole && <span className="text-muted-foreground font-normal"> · {fournisseur.contactRole}</span>}</p>}
          {fournisseur.email && (
            <p className="flex items-center gap-1.5 text-muted-foreground"><EnvelopeSimpleIcon className="size-3.5" />{fournisseur.email}</p>
          )}
          {fournisseur.phone && (
            <p className="flex items-center gap-1.5 text-muted-foreground"><PhoneIcon className="size-3.5" />{fournisseur.phone}</p>
          )}
          {fournisseur.website && (
            <a href={fournisseur.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
              <GlobeIcon className="size-3.5" />{fournisseur.website}
            </a>
          )}
          {!fournisseur.contactName && !fournisseur.email && !fournisseur.phone && !fournisseur.website && (
            <p className="text-muted-foreground">{t("fournisseurs.detail.noContactInfo")}</p>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("fournisseurs.detail.addressAndIds")}</p>
          {(fournisseur.address || fournisseur.city) && (
            <p className="flex items-start gap-1.5 text-muted-foreground">
              <MapPinIcon className="size-3.5 mt-0.5 shrink-0" />
              <span>{[fournisseur.address, [fournisseur.postalCode, fournisseur.city].filter(Boolean).join(" "), fournisseur.country].filter(Boolean).join(", ")}</span>
            </p>
          )}
          {fournisseur.siret && <p className="text-muted-foreground">{t("fournisseurs.detail.siret", { value: fournisseur.siret })}</p>}
          {fournisseur.vatNumber && <p className="text-muted-foreground">{t("fournisseurs.detail.vat", { value: fournisseur.vatNumber })}</p>}
          {!fournisseur.address && !fournisseur.siret && !fournisseur.vatNumber && (
            <p className="text-muted-foreground">{t("fournisseurs.detail.noInfo")}</p>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("fournisseurs.detail.internalNotes")}</p>
          <p className="text-muted-foreground whitespace-pre-wrap">{fournisseur.notes || t("fournisseurs.detail.noNotes")}</p>
        </div>
      </div>

      <Tabs defaultValue={modules.devis ? "devis" : modules.factures ? "factures" : "documents"}>
        <TabsList>
          {modules.devis && <TabsTrigger value="devis">{t("fournisseurs.detail.tabs.devis")}</TabsTrigger>}
          {modules.factures && <TabsTrigger value="factures">{t("fournisseurs.detail.tabs.factures")}</TabsTrigger>}
          {modules.factures && <TabsTrigger value="paiements">{t("fournisseurs.detail.tabs.paiements")}</TabsTrigger>}
          <TabsTrigger value="documents">{t("fournisseurs.detail.tabs.documents")}</TabsTrigger>
          <TabsTrigger value="historique">{t("fournisseurs.detail.tabs.historique")}</TabsTrigger>
        </TabsList>

        {modules.devis && (
        <TabsContent value="devis" className="pt-3">
          {(devisResult?.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("fournisseurs.detail.noDevis")}</p>
          ) : (
            <div className="space-y-2">
              {(devisResult?.data as Array<{ id: string; number: string; issueDate: string; total: string; status: string }> ?? []).map(d => {
                const s = devisStatusBadge[d.status]
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => router.push(`/dashboard/devis?fournisseurId=${id}`)}
                    className="flex w-full items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-left text-sm hover:bg-muted/40 transition-colors"
                  >
                    <div>
                      <p className="font-medium tabular-nums">{d.number}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(d.issueDate), "dd/MM/yyyy", { locale: fr })}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums font-medium">{fmt(d.total)}</span>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          {(devisResult?.total ?? 0) > TAB_PAGE_SIZE && (
            <button type="button" onClick={() => router.push(`/dashboard/devis?fournisseurId=${id}`)} className="mt-2 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
              {t("fournisseurs.detail.viewAll", { count: devisResult?.total ?? 0 })}
            </button>
          )}
        </TabsContent>
        )}

        {modules.factures && (
        <TabsContent value="factures" className="pt-3">
          {(facturesResult?.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("fournisseurs.detail.noFacture")}</p>
          ) : (
            <div className="space-y-2">
              {(facturesResult?.data as Array<{ id: string; number: string; issueDate: string; total: string; status: string }> ?? []).map(f => {
                const s = factureStatusBadge[f.status]
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => router.push(`/dashboard/factures?fournisseurId=${id}`)}
                    className="flex w-full items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-left text-sm hover:bg-muted/40 transition-colors"
                  >
                    <div>
                      <p className="font-medium tabular-nums">{f.number}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(f.issueDate), "dd/MM/yyyy", { locale: fr })}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums font-medium">{fmt(f.total)}</span>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          {(facturesResult?.total ?? 0) > TAB_PAGE_SIZE && (
            <button type="button" onClick={() => router.push(`/dashboard/factures?fournisseurId=${id}`)} className="mt-2 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2">
              {t("fournisseurs.detail.viewAll", { count: facturesResult?.total ?? 0 })}
            </button>
          )}
        </TabsContent>
        )}

        {modules.factures && (
        <TabsContent value="paiements" className="pt-3">
          {payments.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("fournisseurs.detail.noPayment")}</p>
          ) : (
            <div className="space-y-2">
              {payments.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => router.push(`/dashboard/factures?fournisseurId=${id}`)}
                  className="flex w-full items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-left text-sm hover:bg-muted/40 transition-colors"
                >
                  <div>
                    <p className="font-medium tabular-nums">{fmt(p.amount)}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.method} · {format(new Date(p.paidAt), "dd/MM/yyyy", { locale: fr })}
                      {p.note && <> · {p.note}</>}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums">{p.facture.number}</span>
                </button>
              ))}
            </div>
          )}
        </TabsContent>
        )}

        <TabsContent value="documents" className="pt-3">
          {documents.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("fournisseurs.detail.noDocument")}</p>
          ) : (
            <div className="space-y-2">
              {documents.map(doc => (
                <div key={doc.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-sm">
                  <div>
                    <p className="font-medium flex items-center gap-1.5">
                      {documentTypeLabel[doc.type] ?? doc.type}{doc.number && <span className="text-muted-foreground font-normal"> · {doc.number}</span>}
                      {doc.status === "PAYEE" && (
                        <span
                          className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                          title={t("fournisseurs.detail.inFinancesTooltip")}
                        >
                          <ReceiptIcon className="size-3" /> {t("fournisseurs.detail.inFinances")}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{format(new Date(doc.issueDate), "dd/MM/yyyy", { locale: fr })} · {fmt(doc.amount)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-muted-foreground hover:text-foreground" title={t("fournisseurs.detail.viewDocument")}>
                      <ArrowSquareOutIcon className="size-4" />
                    </a>
                    <RowActions actions={[
                      { label: t("fournisseurs.detail.delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, onClick: () => setDeleteDocTarget({ id: doc.id, label: documentTypeLabel[doc.type] ?? doc.type, payee: doc.status === "PAYEE" }) },
                    ]} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {(documentsResult?.total ?? 0) > TAB_PAGE_SIZE && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("fournisseurs.detail.showingRecentDocuments", { count: TAB_PAGE_SIZE, total: documentsResult?.total ?? 0 })}
            </p>
          )}
        </TabsContent>

        <TabsContent value="historique" className="pt-3">
          <ActivityLogList
            logs={logs}
            total={logsTotal}
            hasMore={!!hasMoreLogs}
            onLoadMore={() => fetchMoreLogs()}
            loadingMore={loadingMoreLogs}
          />
        </TabsContent>
      </Tabs>

      <Modal open={editOpen} onOpenChange={setEditOpen} title={t("fournisseurs.detail.editTitle")} size="lg" dismissable={false}>
        <FournisseurForm
          defaultValues={{
            companyName:  fournisseur.companyName,
            tradeName:    fournisseur.tradeName    ?? "",
            contactName:  fournisseur.contactName  ?? "",
            contactRole:  fournisseur.contactRole  ?? "",
            siret:        fournisseur.siret        ?? "",
            siren:        fournisseur.siren        ?? "",
            vatNumber:    fournisseur.vatNumber    ?? "",
            address:      fournisseur.address      ?? "",
            city:         fournisseur.city         ?? "",
            postalCode:   fournisseur.postalCode   ?? "",
            country:      fournisseur.country      ?? "France",
            email:        fournisseur.email        ?? "",
            billingEmail: fournisseur.billingEmail ?? "",
            phone:        fournisseur.phone        ?? "",
            website:      fournisseur.website      ?? "",
            category:     fournisseur.category     ?? "",
            status:       fournisseur.status,
            notes:        fournisseur.notes        ?? "",
          }}
          onSubmit={handleUpdate}
          onCancel={() => setEditOpen(false)}
          loading={updateMutation.isPending}
        />
      </Modal>

      <Modal open={createDevisOpen} onOpenChange={setCreateDevisOpen} title={t("fournisseurs.detail.newDevisTitle")} size="2xl" dismissable={false}>
        <DevisForm
          defaultValues={{ fournisseurId: id }}
          onSubmit={handleCreateDevis}
          onCancel={() => setCreateDevisOpen(false)}
          loading={createDevisMutation.isPending}
        />
      </Modal>

      <Modal open={createFactureOpen} onOpenChange={setCreateFactureOpen} title={t("fournisseurs.detail.newFactureTitle")} size="2xl" dismissable={false}>
        <FactureForm
          defaultValues={{ fournisseurId: id }}
          onSubmit={handleCreateFacture}
          onCancel={() => setCreateFactureOpen(false)}
          loading={createFactureMutation.isPending}
        />
      </Modal>

      <Modal open={createDocOpen} onOpenChange={setCreateDocOpen} title={t("fournisseurs.detail.addDocumentTitle")} size="lg" dismissable={false}>
        <FactureRecueForm
          onSubmit={handleCreateDoc}
          onCancel={() => setCreateDocOpen(false)}
          loading={createDocMutation.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t("fournisseurs.view.archiveConfirmTitle", { name: fournisseur.companyName })}
        description={
          (devisResult?.total ?? 0) + (facturesResult?.total ?? 0) > 0
            ? t("fournisseurs.view.archiveConfirmWithDependencies", { devis: devisResult?.total ?? 0, factures: facturesResult?.total ?? 0 })
            : t("fournisseurs.view.archiveConfirmSimple")
        }
        confirmLabel={t("fournisseurs.view.actions.archive")}
        loading={archiveMutation.isPending}
        onConfirm={handleArchive}
      />

      <ConfirmDialog
        open={!!deleteDocTarget}
        onOpenChange={(open) => !open && setDeleteDocTarget(null)}
        title={t("fournisseurs.detail.deleteDocumentTitle")}
        description={
          deleteDocTarget?.payee
            ? t("fournisseurs.detail.deleteDocumentPaidDescription")
            : t("fournisseurs.detail.deleteDocumentDescription")
        }
        confirmLabel={t("common.delete")}
        loading={deleteDocMutation.isPending}
        onConfirm={handleDeleteDoc}
      />
    </div>
  )
}
