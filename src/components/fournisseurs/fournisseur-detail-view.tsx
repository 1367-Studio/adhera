"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useInfiniteQuery } from "@tanstack/react-query"
import { toast } from "sonner"
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

const fournisseurStatusBadge: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  ACTIF:   { label: "Actif",   variant: "default"   },
  INACTIF: { label: "Inactif", variant: "secondary" },
  ARCHIVE: { label: "Archivé", variant: "outline"   },
}

const devisStatusBadge: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  BROUILLON: { label: "Brouillon", variant: "secondary"   },
  ENVOYE:    { label: "Envoyé",    variant: "outline"     },
  ACCEPTE:   { label: "Accepté",   variant: "default"     },
  REFUSE:    { label: "Refusé",    variant: "destructive" },
  EXPIRE:    { label: "Expiré",    variant: "outline"     },
}

const factureStatusBadge: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  BROUILLON:           { label: "Brouillon",           variant: "secondary"   },
  EN_ATTENTE:          { label: "En attente",          variant: "outline"     },
  PARTIELLEMENT_PAYEE: { label: "Partiellement payée", variant: "outline"     },
  PAYEE:               { label: "Payée",               variant: "default"    },
  EN_RETARD:           { label: "En retard",           variant: "destructive" },
  ANNULEE:             { label: "Annulée",             variant: "secondary"  },
}

const documentTypeLabel: Record<string, string> = {
  facture:     "Facture",
  devis_recu:  "Devis reçu",
  comprovante: "Justificatif",
  contrat:     "Contrat",
  autre:       "Autre",
}

const fmt = (n: number | string) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

export function FournisseurDetailView() {
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
      toast.success("Fournisseur mis à jour")
      setEditOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleArchive() {
    try {
      await archiveMutation.mutateAsync(id)
      toast.success("Fournisseur archivé")
      router.push("/dashboard/fournisseurs")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleCreateDevis(data: DevisInput) {
    try {
      await createDevisMutation.mutateAsync({ ...data, fournisseurId: id })
      toast.success("Devis créé avec succès")
      setCreateDevisOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleCreateFacture(data: FactureInput) {
    try {
      await createFactureMutation.mutateAsync({ ...data, fournisseurId: id })
      toast.success("Facture créée avec succès")
      setCreateFactureOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleCreateDoc(data: FactureRecueInput) {
    try {
      await createDocMutation.mutateAsync({ ...data, fournisseurId: id })
      toast.success("Document ajouté")
      setCreateDocOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDeleteDoc() {
    if (!deleteDocTarget) return
    try {
      await deleteDocMutation.mutateAsync(deleteDocTarget.id)
      toast.success("Document supprimé")
      setDeleteDocTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  if (isLoading) {
    return <DetailLoadingSkeleton />
  }

  if (isError || !fournisseur) {
    return (
      <DetailNotFound
        message="Ce fournisseur est introuvable ou a été supprimé."
        backHref="/dashboard/fournisseurs"
        backLabel="Retour à la liste"
      />
    )
  }

  const statusInfo = fournisseurStatusBadge[fournisseur.status]

  return (
    <div className="space-y-4 mt-4">
      <div className="space-y-3">
        <BackLink href="/dashboard/fournisseurs">Fournisseurs</BackLink>

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
                Devis
              </Button>
            )}
            {modules.factures && (
              <Button size="sm" variant="outline" onClick={() => setCreateFactureOpen(true)}>
                <ReceiptIcon className="mr-1.5 size-4" />
                Facture
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setCreateDocOpen(true)}>
              <PaperclipIcon className="mr-1.5 size-4" />
              Document
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <PencilSimpleIcon className="mr-1.5 size-4" />
              Modifier
            </Button>
            {fournisseur.status !== "ARCHIVE" && (
              <Button size="sm" variant="outline" onClick={() => setArchiveOpen(true)}>
                <ArchiveIcon className="mr-1.5 size-4" />
                Archiver
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contact</p>
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
            <p className="text-muted-foreground">Aucune information de contact</p>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Adresse & identifiants</p>
          {(fournisseur.address || fournisseur.city) && (
            <p className="flex items-start gap-1.5 text-muted-foreground">
              <MapPinIcon className="size-3.5 mt-0.5 shrink-0" />
              <span>{[fournisseur.address, [fournisseur.postalCode, fournisseur.city].filter(Boolean).join(" "), fournisseur.country].filter(Boolean).join(", ")}</span>
            </p>
          )}
          {fournisseur.siret && <p className="text-muted-foreground">SIRET : {fournisseur.siret}</p>}
          {fournisseur.vatNumber && <p className="text-muted-foreground">TVA : {fournisseur.vatNumber}</p>}
          {!fournisseur.address && !fournisseur.siret && !fournisseur.vatNumber && (
            <p className="text-muted-foreground">Aucune information</p>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes internes</p>
          <p className="text-muted-foreground whitespace-pre-wrap">{fournisseur.notes || "Aucune note"}</p>
        </div>
      </div>

      <Tabs defaultValue={modules.devis ? "devis" : modules.factures ? "factures" : "documents"}>
        <TabsList>
          {modules.devis && <TabsTrigger value="devis">Devis</TabsTrigger>}
          {modules.factures && <TabsTrigger value="factures">Factures</TabsTrigger>}
          {modules.factures && <TabsTrigger value="paiements">Paiements</TabsTrigger>}
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="historique">Historique</TabsTrigger>
        </TabsList>

        {modules.devis && (
        <TabsContent value="devis" className="pt-3">
          {(devisResult?.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucun devis pour ce fournisseur</p>
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
              Voir tout ({devisResult?.total})
            </button>
          )}
        </TabsContent>
        )}

        {modules.factures && (
        <TabsContent value="factures" className="pt-3">
          {(facturesResult?.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune facture pour ce fournisseur</p>
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
              Voir tout ({facturesResult?.total})
            </button>
          )}
        </TabsContent>
        )}

        {modules.factures && (
        <TabsContent value="paiements" className="pt-3">
          {payments.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucun paiement enregistré</p>
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
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucun document reçu</p>
          ) : (
            <div className="space-y-2">
              {documents.map(doc => (
                <div key={doc.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-sm">
                  <div>
                    <p className="font-medium flex items-center gap-1.5">
                      {documentTypeLabel[doc.type] ?? doc.type}{doc.number && <span className="text-muted-foreground font-normal"> · {doc.number}</span>}
                      {doc.status === "PAYEE" && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                          title="Payée — génère une dépense dans Finances ; la supprimer ou changer son statut supprime aussi cette dépense"
                        >
                          <ReceiptIcon className="size-3" /> Dans Finances
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{format(new Date(doc.issueDate), "dd/MM/yyyy", { locale: fr })} · {fmt(doc.amount)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-muted-foreground hover:text-foreground" title="Voir le document">
                      <ArrowSquareOutIcon className="size-4" />
                    </a>
                    <RowActions actions={[
                      { label: "Supprimer", icon: <TrashIcon className="size-3.5" />, destructive: true, onClick: () => setDeleteDocTarget({ id: doc.id, label: documentTypeLabel[doc.type] ?? doc.type, payee: doc.status === "PAYEE" }) },
                    ]} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {(documentsResult?.total ?? 0) > TAB_PAGE_SIZE && (
            <p className="mt-2 text-xs text-muted-foreground">
              Affichage des {TAB_PAGE_SIZE} documents les plus récents sur {documentsResult?.total} au total.
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

      <Modal open={editOpen} onOpenChange={setEditOpen} title="Modifier le fournisseur" size="lg" dismissable={false}>
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

      <Modal open={createDevisOpen} onOpenChange={setCreateDevisOpen} title="Nouveau devis" size="2xl" dismissable={false}>
        <DevisForm
          defaultValues={{ fournisseurId: id }}
          onSubmit={handleCreateDevis}
          onCancel={() => setCreateDevisOpen(false)}
          loading={createDevisMutation.isPending}
        />
      </Modal>

      <Modal open={createFactureOpen} onOpenChange={setCreateFactureOpen} title="Nouvelle facture" size="2xl" dismissable={false}>
        <FactureForm
          defaultValues={{ fournisseurId: id }}
          onSubmit={handleCreateFacture}
          onCancel={() => setCreateFactureOpen(false)}
          loading={createFactureMutation.isPending}
        />
      </Modal>

      <Modal open={createDocOpen} onOpenChange={setCreateDocOpen} title="Ajouter un document" size="lg" dismissable={false}>
        <FactureRecueForm
          onSubmit={handleCreateDoc}
          onCancel={() => setCreateDocOpen(false)}
          loading={createDocMutation.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archiver ${fournisseur.companyName} ?`}
        description={
          (devisResult?.total ?? 0) + (facturesResult?.total ?? 0) > 0
            ? `Ce fournisseur n'apparaîtra plus dans les listes. Il reste lié à ${devisResult?.total ?? 0} devis et ${facturesResult?.total ?? 0} facture(s) — ils resteront consultables, mais ce fournisseur n'apparaîtra plus dans les formulaires de création (sauf sur ces documents existants).`
            : "Ce fournisseur n'apparaîtra plus dans les listes."
        }
        confirmLabel="Archiver"
        loading={archiveMutation.isPending}
        onConfirm={handleArchive}
      />

      <ConfirmDialog
        open={!!deleteDocTarget}
        onOpenChange={(open) => !open && setDeleteDocTarget(null)}
        title={`Supprimer ce document ?`}
        description={
          deleteDocTarget?.payee
            ? "Cette action est irréversible. Ce document est marqué payée : la dépense qu'il a générée dans Finances (et sa réconciliation bancaire éventuelle) sera supprimée avec lui."
            : "Cette action est irréversible."
        }
        confirmLabel="Supprimer"
        loading={deleteDocMutation.isPending}
        onConfirm={handleDeleteDoc}
      />
    </div>
  )
}
