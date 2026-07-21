"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import {
  PencilSimpleIcon, TrashIcon, ShieldIcon, KeyIcon, PlusIcon,
  EnvelopeSimpleIcon, PhoneIcon, MapPinIcon, CalendarIcon, UserIcon, WarningIcon
} from "@phosphor-icons/react/dist/ssr";
import { useMembre, useUpdateMembre, useDeleteMembre, useCreateAccess } from "@/hooks/use-membres"
import { useCreateCotisation } from "@/hooks/use-cotisations"
import type { MembreInput, CotisationInput } from "@/lib/schemas"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { MembreForm } from "@/components/membres/membre-form"
import { MembreActivityLog } from "@/components/membres/membre-activity-log"
import { MembreEmailLog } from "@/components/membres/membre-email-log"
import { CotisationForm } from "@/components/cotisations/cotisation-form"
import { MembreTypeBadge } from "@/components/ui/membre-type-badge"
import { RsvpBadge } from "@/components/portal/rsvp-badge"
import { ChangeRoleModal } from "@/components/membres/membres-view"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { useCurrentUser, useModules } from "@/lib/user-context"

const ROLE_LABELS: Record<string, string> = {
  ADMIN:      "Admin",
  PRESIDENT:  "Président",
  TRESORIER:  "Trésorier",
  SECRETAIRE: "Secrétaire",
  MEMBRE:     "Membre",
}

const CIVILITE_LABELS: Record<string, string> = {
  MME:  "Mme",
  MLLE: "Mlle",
  M:    "M.",
}

const GROUPE_SANGUIN_LABELS: Record<string, string> = {
  A_POSITIF:  "A+",
  A_NEGATIF:  "A-",
  B_POSITIF:  "B+",
  B_NEGATIF:  "B-",
  AB_POSITIF: "AB+",
  AB_NEGATIF: "AB-",
  O_POSITIF:  "O+",
  O_NEGATIF:  "O-",
}

const statusBadge: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PENDING:  { label: "En attente", variant: "outline"     },
  ACTIF:    { label: "Actif",      variant: "default"     },
  INACTIF:  { label: "Inactif",    variant: "secondary"   },
  SUSPENDU: { label: "Suspendu",   variant: "destructive" },
}

const cotisationStatusBadge: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  EN_ATTENTE: { label: "En attente", variant: "secondary" },
  PAYE:       { label: "Payée",      variant: "default"   },
  EXONERE:    { label: "Exonérée",   variant: "outline"   },
}

const loanStatusBadge: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  DEMANDE:  { label: "Demande en attente", variant: "outline"     },
  CONFIRME: { label: "En cours",           variant: "default"     },
  REFUSE:   { label: "Refusé",             variant: "destructive" },
}

const fmt = (n: number | string) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

export function MembreDetailView() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const modules = useModules()
  const currentUser = useCurrentUser()

  const [editOpen, setEditOpen]                 = useState(false)
  const [deleteOpen, setDeleteOpen]             = useState(false)
  const [roleOpen, setRoleOpen]                 = useState(false)
  const [createCotisationOpen, setCreateCotisationOpen] = useState(false)

  const { data: membre, isLoading, isError } = useMembre(id)

  const updateMutation          = useUpdateMembre(id)
  const deleteMutation          = useDeleteMembre()
  const createAccessMutation    = useCreateAccess()
  const createCotisationMutation = useCreateCotisation()

  const isSelf = !!membre && membre.userId === currentUser.id

  async function handleUpdate(data: MembreInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success("Membre mis à jour")
      setEditOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync(id)
      toast.success("Membre supprimé")
      router.push("/dashboard/membres")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleCreateAccess() {
    try {
      await createAccessMutation.mutateAsync(id)
      toast.success("Accès créé — un email a été envoyé")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleCreateCotisation(data: CotisationInput) {
    try {
      await createCotisationMutation.mutateAsync(data)
      toast.success("Cotisation ajoutée")
      setCreateCotisationOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  if (isLoading) {
    return <DetailLoadingSkeleton />
  }

  if (isError || !membre) {
    return (
      <DetailNotFound
        message="Ce membre est introuvable ou a été supprimé."
        backHref="/dashboard/membres"
        backLabel="Retour à la liste"
      />
    )
  }

  const statusInfo     = statusBadge[membre.status]
  const cotisations    = membre.cotisations ?? []
  const participations = membre.participations ?? []
  const materialLoans  = membre.materialLoans ?? []
  const cotisationsTotal    = membre._count?.cotisations    ?? cotisations.length
  const participationsTotal = membre._count?.participations ?? participations.length
  const materialLoansTotal  = membre._count?.materialLoans  ?? materialLoans.length
  const TAB_PAGE_SIZE = 50

  return (
    <div className="space-y-4 mt-4">
      <div className="space-y-3">
        <BackLink href="/dashboard/membres">Membres</BackLink>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              {membre.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={membre.photoUrl}
                  alt=""
                  className="size-14 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="size-14 rounded-full bg-muted flex items-center justify-center text-base font-medium text-muted-foreground shrink-0">
                  {membre.firstName[0]}{membre.lastName[0]}
                </div>
              )}
              <h1 className="text-xl font-semibold">{membre.firstName} {membre.lastName}</h1>
              <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
              {membre.type && <MembreTypeBadge name={membre.type.name} color={membre.type.color} />}
              {membre.user && membre.user.role !== "MEMBRE" && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 dark:bg-primary/20 text-primary">
                  <ShieldIcon className="size-2.5" />
                  {ROLE_LABELS[membre.user.role] ?? membre.user.role}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Membre depuis {format(new Date(membre.joinedAt), "MMMM yyyy", { locale: fr })}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {modules.cotisations && (
              <Button size="sm" variant="outline" onClick={() => setCreateCotisationOpen(true)}>
                <PlusIcon className="mr-1.5 size-4" />
                Cotisation
              </Button>
            )}
            {!membre.userId && membre.email && (
              <Button size="sm" variant="outline" onClick={handleCreateAccess} loading={createAccessMutation.isPending}>
                <KeyIcon className="mr-1.5 size-4" />
                Créer un accès
              </Button>
            )}
            {/* Role changes are ADMIN/PRESIDENT-only server-side (see membres/[id]/role/route.ts)
                — matching that here instead of the broader isManager() avoids showing an action
                a Trésorier/Secrétaire could open but never actually save. */}
            {(currentUser.role === "ADMIN" || currentUser.role === "PRESIDENT") && membre.userId && !isSelf && (
              <Button size="sm" variant="outline" onClick={() => setRoleOpen(true)}>
                <ShieldIcon className="mr-1.5 size-4" />
                Rôle
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <PencilSimpleIcon className="mr-1.5 size-4" />
              Modifier
            </Button>
            {!isSelf && (
              <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)}>
                <TrashIcon className="mr-1.5 size-4" />
                Supprimer
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contact</p>
          {membre.email && (
            <p className="flex items-center gap-1.5 text-muted-foreground"><EnvelopeSimpleIcon className="size-3.5" />{membre.email}</p>
          )}
          {membre.phone && (
            <p className="flex items-center gap-1.5 text-muted-foreground"><PhoneIcon className="size-3.5" />{membre.phone}</p>
          )}
          {membre.address && (
            <p className="flex items-start gap-1.5 text-muted-foreground"><MapPinIcon className="size-3.5 mt-0.5 shrink-0" /><span>{membre.address}</span></p>
          )}
          {!membre.email && !membre.phone && !membre.address && (
            <p className="text-muted-foreground">Aucune information de contact</p>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Adhésion</p>
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarIcon className="size-3.5" />
            Adhésion : {format(new Date(membre.joinedAt), "dd/MM/yyyy", { locale: fr })}
          </p>
          {membre.type && <p className="text-muted-foreground">Type : {membre.type.name}</p>}
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Informations personnelles</p>
          {membre.civilite && (
            <p className="text-muted-foreground">Civilité : {CIVILITE_LABELS[membre.civilite] ?? membre.civilite}</p>
          )}
          {membre.birthDate && (
            <p className="text-muted-foreground">Naissance : {format(new Date(membre.birthDate), "dd/MM/yyyy", { locale: fr })}</p>
          )}
          {membre.groupeSanguin && (
            <p className="text-muted-foreground">Groupe sanguin : {GROUPE_SANGUIN_LABELS[membre.groupeSanguin] ?? membre.groupeSanguin}</p>
          )}
          {membre.allergies && (
            <p className="flex items-start gap-1.5 text-muted-foreground">
              <WarningIcon className="size-3.5 mt-0.5 shrink-0" />
              <span>Allergies : {membre.allergies}</span>
            </p>
          )}
          {!membre.civilite && !membre.birthDate && !membre.groupeSanguin && !membre.allergies && (
            <p className="text-muted-foreground">Aucune information renseignée</p>
          )}
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Compte & accès</p>
          {membre.userId ? (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <UserIcon className="size-3.5" />
              Compte actif · {ROLE_LABELS[membre.user?.role ?? "MEMBRE"]}
            </p>
          ) : (
            <p className="text-muted-foreground">
              Aucun compte utilisateur{membre.email ? " — un accès peut être créé" : " — email requis pour créer un accès"}
            </p>
          )}
        </div>
      </div>

      <Tabs defaultValue={modules.cotisations ? "cotisations" : modules.evenements ? "evenements" : modules.materiel ? "materiel" : "historique"}>
        <TabsList>
          {modules.cotisations && <TabsTrigger value="cotisations">Cotisations</TabsTrigger>}
          {modules.evenements && <TabsTrigger value="evenements">Événements</TabsTrigger>}
          {modules.materiel && <TabsTrigger value="materiel">Matériel</TabsTrigger>}
          <TabsTrigger value="historique">Historique</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
        </TabsList>

        {modules.cotisations && (
        <TabsContent value="cotisations" className="pt-3">
          {cotisations.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune cotisation enregistrée</p>
          ) : (
            <div className="space-y-2">
              {cotisations.map((c: { id: string; year: number; amount: string; status: string; paidAt: string | null }) => {
                const s = cotisationStatusBadge[c.status]
                return (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-sm">
                    <div>
                      <p className="font-medium tabular-nums">{c.year}</p>
                      {c.paidAt && <p className="text-xs text-muted-foreground">Payée le {format(new Date(c.paidAt), "dd/MM/yyyy", { locale: fr })}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums font-medium">{fmt(c.amount)}</span>
                      <Badge variant={s.variant}>{s.label}</Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {cotisationsTotal > TAB_PAGE_SIZE && (
            <p className="mt-2 text-xs text-muted-foreground">
              Affichage des {TAB_PAGE_SIZE} cotisations les plus récentes sur {cotisationsTotal} au total.
            </p>
          )}
        </TabsContent>
        )}

        {modules.evenements && (
        <TabsContent value="evenements" className="pt-3">
          {participations.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucune participation enregistrée</p>
          ) : (
            <div className="space-y-2">
              {participations.map((p: { id: string; evenementId: string; present: boolean; rsvp: string | null; evenement: { title: string; date: string } }) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => router.push(`/dashboard/evenements/${p.evenementId}/presences`)}
                  className="flex w-full items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-left text-sm hover:bg-muted/40 transition-colors"
                >
                  <div>
                    <p className="font-medium">{p.evenement.title}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(p.evenement.date), "dd/MM/yyyy", { locale: fr })}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.present && <Badge variant="default">Présent</Badge>}
                    {p.rsvp && <RsvpBadge rsvp={p.rsvp} />}
                  </div>
                </button>
              ))}
            </div>
          )}
          {participationsTotal > TAB_PAGE_SIZE && (
            <p className="mt-2 text-xs text-muted-foreground">
              Affichage des {TAB_PAGE_SIZE} participations les plus récentes sur {participationsTotal} au total.
            </p>
          )}
        </TabsContent>
        )}

        {modules.materiel && (
        <TabsContent value="materiel" className="pt-3">
          {materialLoans.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Aucun prêt de matériel</p>
          ) : (
            <div className="space-y-2">
              {materialLoans.map((l: { id: string; status: string; quantity: number; borrowedAt: string; returnedAt: string | null; material: { name: string } }) => {
                const s = loanStatusBadge[l.status]
                return (
                  <div key={l.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-sm">
                    <div>
                      <p className="font-medium">{l.material.name}{l.quantity > 1 && <span className="text-muted-foreground font-normal"> · x{l.quantity}</span>}</p>
                      <p className="text-xs text-muted-foreground">
                        Emprunté le {format(new Date(l.borrowedAt), "dd/MM/yyyy", { locale: fr })}
                        {l.returnedAt && <> · Rendu le {format(new Date(l.returnedAt), "dd/MM/yyyy", { locale: fr })}</>}
                      </p>
                    </div>
                    <Badge variant={l.returnedAt ? "secondary" : s.variant}>{l.returnedAt ? "Rendu" : s.label}</Badge>
                  </div>
                )
              })}
            </div>
          )}
          {materialLoansTotal > TAB_PAGE_SIZE && (
            <p className="mt-2 text-xs text-muted-foreground">
              Affichage des {TAB_PAGE_SIZE} prêts les plus récents sur {materialLoansTotal} au total.
            </p>
          )}
        </TabsContent>
        )}

        <TabsContent value="historique" className="pt-3">
          <MembreActivityLog membreId={id} />
        </TabsContent>

        <TabsContent value="emails" className="pt-3">
          <MembreEmailLog membreId={id} />
        </TabsContent>
      </Tabs>

      <Modal open={editOpen} onOpenChange={setEditOpen} title="Modifier le membre" size="lg" dismissable={false}>
        <MembreForm
          defaultValues={{
            firstName: membre.firstName,
            lastName:  membre.lastName,
            email:     membre.email ?? "",
            phone:     membre.phone ?? "",
            birthDate: membre.birthDate ? membre.birthDate.split("T")[0] : "",
            status:    membre.status,
            typeId:    membre.typeId ?? "",
            civilite:      membre.civilite      ?? "",
            groupeSanguin: membre.groupeSanguin ?? "",
            allergies:     membre.allergies     ?? "",
            photoUrl:      membre.photoUrl      ?? "",
          }}
          onSubmit={handleUpdate}
          onCancel={() => setEditOpen(false)}
          loading={updateMutation.isPending}
          isSelf={isSelf}
        />
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Supprimer ${membre.firstName} ${membre.lastName} ?`}
        description="Ce membre sera archivé et ne pourra plus accéder à l'association."
        confirmLabel="Supprimer"
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />

      {roleOpen && (
        <ChangeRoleModal
          membre={membre}
          onClose={() => setRoleOpen(false)}
        />
      )}

      <Modal open={createCotisationOpen} onOpenChange={setCreateCotisationOpen} title="Ajouter une cotisation" size="lg" dismissable={false}>
        <CotisationForm
          membres={[]}
          editMode
          defaultValues={{ membreId: id, year: new Date().getFullYear(), status: "EN_ATTENTE" }}
          onSubmit={handleCreateCotisation}
          onCancel={() => setCreateCotisationOpen(false)}
          loading={createCotisationMutation.isPending}
        />
      </Modal>
    </div>
  )
}
