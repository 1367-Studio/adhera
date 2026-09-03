"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { cn } from "@/lib/utils"
import {
  PencilSimpleIcon, TrashIcon, ShieldIcon, KeyIcon, PlusIcon,
  EnvelopeSimpleIcon, PhoneIcon, MapPinIcon, CalendarIcon, UserIcon, WarningIcon,
  DownloadSimpleIcon, ReceiptIcon, XCircleIcon, CheckIcon
} from "@phosphor-icons/react/dist/ssr";
import { useMembre, useUpdateMembre, useDeleteMembre, useCreateAccess, useCancelCotisationSubscription, useCancelCotisationInstallmentPlan } from "@/hooks/use-membres"
import { spokenLanguageLabel } from "@/lib/languages"
import { useCreateCotisation, useUpdateCotisation } from "@/hooks/use-cotisations"
import type { MembreInput, CotisationInput } from "@/lib/schemas"
import { ApiError } from "@/lib/api-error"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { MembreForm } from "@/components/membres/membre-form"
import { MembreActivityLog } from "@/components/membres/membre-activity-log"
import { MembreEmailLog } from "@/components/membres/membre-email-log"
import { MembreSmsLog } from "@/components/membres/membre-sms-log"
import { CotisationForm } from "@/components/cotisations/cotisation-form"
import { MembreTypeBadge } from "@/components/ui/membre-type-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { RsvpBadge } from "@/components/portal/rsvp-badge"
import { ChangeRoleModal } from "@/components/membres/membres-view"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { useCurrentUser, useModules } from "@/lib/user-context"
import { BASE_PATH } from "@/lib/env"
import { isMembreAdherentViaResponsable } from "@/lib/membre-adherent"

type Translator = ReturnType<typeof useTranslations>

function getRoleLabels(t: Translator): Record<string, string> {
  return {
    ADMIN:      t("membres.form.role.admin"),
    PRESIDENT:  t("membres.form.role.president"),
    TRESORIER:  t("membres.form.role.tresorier"),
    SECRETAIRE: t("membres.form.role.secretaire"),
    MEMBRE:     t("membres.form.role.membre"),
  }
}

function getCiviliteLabels(t: Translator): Record<string, string> {
  return {
    MME:  t("membres.form.civilite.mme"),
    MLLE: t("membres.form.civilite.mlle"),
    M:    t("membres.form.civilite.m"),
  }
}

function getSexeLabels(t: Translator): Record<string, string> {
  return {
    HOMME: t("membres.form.sexe.homme"),
    FEMME: t("membres.form.sexe.femme"),
  }
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

const TAILLE_TSHIRT_LABELS: Record<string, string> = {
  XS: "XS", S: "S", M: "M", L: "L", XL: "XL", XXL: "XXL", XXXL: "XXXL",
}

function getStatusBadge(t: Translator): Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> {
  return {
    PENDING:  { label: t("membres.form.status.pending"),  variant: "outline"     },
    ACTIF:    { label: t("membres.form.status.actif"),    variant: "default"     },
    INACTIF:  { label: t("membres.form.status.inactif"),  variant: "secondary"   },
    SUSPENDU: { label: t("membres.form.status.suspendu"), variant: "destructive" },
  }
}

function getCotisationStatusBadge(t: Translator): Record<string, { label: string; tooltip: string; variant: "default" | "secondary" | "destructive" | "outline" }> {
  return {
    EN_ATTENTE:          { label: t("membres.detail.cotisationStatus.enAttente"),          tooltip: t("cotisations.statusTooltip.enAttente"),          variant: "secondary"   },
    PARTIELLEMENT_PAYEE: { label: t("membres.detail.cotisationStatus.partiellementPayee"), tooltip: t("cotisations.statusTooltip.partiellementPayee"), variant: "outline"     },
    PAYE:                { label: t("membres.detail.cotisationStatus.paye"),               tooltip: t("cotisations.statusTooltip.paye"),               variant: "default"     },
    EN_RETARD:           { label: t("membres.detail.cotisationStatus.enRetard"),           tooltip: t("cotisations.statusTooltip.enRetard"),           variant: "destructive" },
    EXONERE:             { label: t("membres.detail.cotisationStatus.exonere"),            tooltip: t("cotisations.statusTooltip.exonere"),            variant: "outline"     },
    ANNULEE:             { label: t("membres.detail.cotisationStatus.annulee"),            tooltip: t("cotisations.statusTooltip.annulee"),            variant: "secondary"   },
  }
}

function getLoanStatusBadge(t: Translator): Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> {
  return {
    DEMANDE:  { label: t("membres.detail.loanStatus.demande"),  variant: "outline"     },
    CONFIRME: { label: t("membres.detail.loanStatus.confirme"), variant: "default"     },
    REFUSE:   { label: t("membres.detail.loanStatus.refuse"),   variant: "destructive" },
  }
}

// Same labels/variants as reunions-view.tsx's STATUS_LABELS/STATUS_VARIANTS — kept in
// sync manually since that map isn't exported, but must stay identical: a cancelled
// meeting showing up here as "Convoqué" (as if still upcoming) would flatly contradict
// what the meeting's own page says about it.
function getMeetingStatusBadge(t: Translator): Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> {
  return {
    SCHEDULED: { label: t("membres.detail.meetingStatus.scheduled"), variant: "secondary"   },
    LIVE:      { label: t("membres.detail.meetingStatus.live"),      variant: "default"     },
    ENDED:     { label: t("membres.detail.meetingStatus.ended"),     variant: "outline"     },
    CANCELLED: { label: t("membres.detail.meetingStatus.cancelled"), variant: "destructive" },
  }
}

function getSubscriptionStatusBadge(t: Translator): Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> {
  return {
    ACTIVE:    { label: t("membres.detail.recurringSubscriptionStatus.active"),    variant: "default"     },
    PAST_DUE:  { label: t("membres.detail.recurringSubscriptionStatus.pastDue"),   variant: "destructive" },
    CANCELLED: { label: t("membres.detail.recurringSubscriptionStatus.cancelled"), variant: "secondary"   },
  }
}

const fmt = (n: number | string) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

// Only what's needed to fetch a specific cotisation (via GET /api/cotisations/[id]) and open
// it in CotisationForm's edit mode — see openCancelledCotisationForEdit below.
type FetchedCotisation = {
  id:         string
  year:       number
  amount:     string
  amountPaid: string
  status:     "EN_ATTENTE" | "PARTIELLEMENT_PAYEE" | "PAYE" | "EN_RETARD" | "EXONERE" | "ANNULEE"
  dueDate:    string | null
  note:       string | null
  installments: { amount: string; dueDate: string }[]
}

export function MembreDetailView() {
  const { id } = useParams<{ id: string }>()
  const t = useTranslations()
  const router = useRouter()
  const modules = useModules()
  const currentUser = useCurrentUser()

  const [editOpen, setEditOpen]                 = useState(false)
  const [deleteOpen, setDeleteOpen]             = useState(false)
  const [roleOpen, setRoleOpen]                 = useState(false)
  const [cancelSubscriptionOpen, setCancelSubscriptionOpen] = useState(false)
  const [cancelInstallmentOpen, setCancelInstallmentOpen] = useState(false)
  const [createCotisationOpen, setCreateCotisationOpen] = useState(false)
  const [rejectOpen, setRejectOpen]             = useState(false)
  // Set when the create attempt hits a cancelled cotisation already occupying that year (see
  // handleCreateCotisation) — this page has no other "edit cotisation" entry point, so it's
  // opened here rather than sending the admin off to the main Cotisations list to find it.
  const [editCotisationTarget, setEditCotisationTarget] = useState<FetchedCotisation | null>(null)

  const { data: membre, isLoading, isError } = useMembre(id)

  const updateMutation          = useUpdateMembre(id)
  const deleteMutation          = useDeleteMembre()
  const createAccessMutation    = useCreateAccess()
  const cancelSubscriptionMutation = useCancelCotisationSubscription()
  const cancelInstallmentMutation = useCancelCotisationInstallmentPlan()
  const createCotisationMutation = useCreateCotisation()
  const updateCotisationMutation = useUpdateCotisation(editCotisationTarget?.id ?? "")

  const isSelf = !!membre && membre.userId === currentUser.id

  async function handleUpdate(data: MembreInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t("membres.view.toasts.memberUpdated"))
      setEditOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete() {
    try {
      const { unlinkedDependants } = await deleteMutation.mutateAsync(id)
      toast.success(unlinkedDependants > 0
        ? t("membres.view.toasts.memberDeletedWithUnlink", { count: unlinkedDependants })
        : t("membres.view.toasts.memberDeleted"))
      router.push("/dashboard/membres")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleCreateAccess() {
    try {
      await createAccessMutation.mutateAsync(id)
      toast.success(t("membres.detail.toasts.accessCreated"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  // Approving/refusing a "validation sur demande" signup is just a status change — the whole
  // side-effect chain (free Cotisation, portal access + invitation email, clearing
  // pendingTierId) lives in PATCH /api/membres/[id], so there is deliberately no dedicated
  // endpoint here. Only `status` is sent: membreUpdateSchema is a .partial(), and the route
  // only writes the keys it actually receives.
  async function handleApprove() {
    try {
      await updateMutation.mutateAsync({ status: "ACTIF" })
      toast.success(t("membres.detail.pendingRequest.approvedToast"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  // INACTIF rather than deleting the row: the person still applied, and that history (plus
  // their answers to the form) is worth keeping. It also flips User.active to false
  // server-side, so a refused applicant can't log in.
  async function handleReject() {
    try {
      await updateMutation.mutateAsync({ status: "INACTIF" })
      toast.success(t("membres.detail.pendingRequest.rejectedToast"))
      setRejectOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleCancelSubscription() {
    try {
      await cancelSubscriptionMutation.mutateAsync(id)
      toast.success(t("membres.detail.toasts.subscriptionCancelled"))
      setCancelSubscriptionOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleCancelInstallment() {
    try {
      await cancelInstallmentMutation.mutateAsync(id)
      toast.success(t("membres.detail.toasts.installmentCancelled"))
      setCancelInstallmentOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  // Fetch-and-save instead of window.open — a non-2xx response (fiscal receipts not enabled,
  // cotisation not eligible, etc.) would otherwise just open a new tab showing raw JSON instead
  // of any legible feedback, same reasoning as dashboard/dons/page.tsx's own downloadRecu.
  async function downloadCotisationRecu(cotisationId: string) {
    try {
      const res = await fetch(`${BASE_PATH}/api/membres/${id}/cotisations/${cotisationId}/recu`)
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        toast.error(body?.error ?? t("common.error"))
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href = url
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? `recu-fiscal-${cotisationId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t("common.error"))
    }
  }

  // Mirrors cotisations-view.tsx's own openCancelledForEdit — a cotisation exists per
  // (membre, year) forever regardless of status, so a cancelled one blocks creating a new one
  // for the same year (see POST /api/cotisations). This page has no other way to reach that
  // cancelled cotisation to edit it, so it's fetched and opened right here.
  async function openCancelledCotisationForEdit(cotisationId: string) {
    try {
      const res = await fetch(`/api/cotisations/${cotisationId}`)
      if (!res.ok) { toast.error(t("common.error")); return }
      const cotisation = await res.json() as FetchedCotisation
      setCreateCotisationOpen(false)
      setEditCotisationTarget(cotisation)
    } catch {
      toast.error(t("common.networkError"))
    }
  }

  async function handleCreateCotisation(data: CotisationInput) {
    try {
      await createCotisationMutation.mutateAsync(data)
      toast.success(t("membres.detail.toasts.cotisationAdded"))
      setCreateCotisationOpen(false)
    } catch (err) {
      if (err instanceof ApiError && err.code === "CANCELLED_EXISTS" && typeof err.details?.cotisationId === "string") {
        const cotisationId = err.details.cotisationId
        toast.error(err.message, {
          action: { label: t("cotisations.view.toasts.editCancelled"), onClick: () => openCancelledCotisationForEdit(cotisationId) },
        })
        return
      }
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUpdateCotisation(data: CotisationInput) {
    try {
      await updateCotisationMutation.mutateAsync(data)
      toast.success(t("membres.detail.toasts.cotisationUpdated"))
      setEditCotisationTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  if (isLoading) {
    return <DetailLoadingSkeleton />
  }

  if (isError || !membre) {
    return (
      <DetailNotFound
        message={t("membres.detail.notFound")}
        backHref="/dashboard/membres"
        backLabel={t("membres.detail.backToList")}
      />
    )
  }

  const roleLabels            = getRoleLabels(t)
  const civiliteLabels        = getCiviliteLabels(t)
  const sexeLabels            = getSexeLabels(t)
  const statusBadge           = getStatusBadge(t)
  const cotisationStatusBadge = getCotisationStatusBadge(t)
  const loanStatusBadge       = getLoanStatusBadge(t)
  const meetingStatusBadge    = getMeetingStatusBadge(t)
  const subscriptionStatusBadge = getSubscriptionStatusBadge(t)
  const statusInfo            = statusBadge[membre.status]
  const cotisations           = membre.cotisations ?? []
  const participations        = membre.participations ?? []
  const meetingsAsParticipant = membre.meetingsAsParticipant ?? []
  const materialLoans         = membre.materialLoans ?? []
  const cotisationsTotal      = membre._count?.cotisations    ?? cotisations.length
  const participationsTotal   = membre._count?.participations ?? participations.length
  const meetingsTotal         = membre._count?.meetingsAsParticipant ?? meetingsAsParticipant.length
  const materialLoansTotal    = membre._count?.materialLoans  ?? materialLoans.length
  // ADDON purchases and DONATION-item-type extras live in two different tables (see
  // Don.membershipAddonTierId) but are the same thing from this member's point of view —
  // merged into one chronological list rather than two separate sub-sections.
  // A pending don (paidAt null) has no date to sort by — treated as "now" (Infinity) rather
  // than "" so it floats to the top instead of sinking below every already-paid row, however
  // old. It's the one row here that still needs someone's attention.
  const purchaseSortKey = (date: string | null) => date ? new Date(date).getTime() : Infinity
  const addonPurchases = [
    ...membre.membershipAddonPurchases.map(p => ({ id: p.id, label: p.label, amount: p.amount, date: p.purchasedAt })),
    ...membre.dons.map(d => ({ id: d.id, label: d.membershipAddonTier?.label ?? t("membres.detail.donationFallbackLabel"), amount: d.amount, date: d.paidAt })),
  ].sort((a, b) => purchaseSortKey(b.date) - purchaseSortKey(a.date))
  const TAB_PAGE_SIZE         = 50

  return (
    <div className="space-y-4 mt-4">
      <div className="space-y-3">
        <BackLink href="/dashboard/membres">{t("membres.detail.backLink")}</BackLink>

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
              {modules.cotisations && (
                <Badge
                  variant={membre.isAdherent ? "secondary" : "outline"}
                  title={isMembreAdherentViaResponsable(membre) ? t("membres.detail.adherentViaResponsable") : undefined}
                >
                  {membre.isAdherent ? t("membres.view.membershipAdherent") : t("membres.view.membershipBenevole")}
                  {isMembreAdherentViaResponsable(membre) && t("membres.detail.viaResponsable")}
                </Badge>
              )}
              {membre.type && <MembreTypeBadge name={membre.type.name} color={membre.type.color} />}
              {membre.user && membre.user.role !== "MEMBRE" && (
                <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-primary/10 dark:bg-primary/20 text-primary">
                  <ShieldIcon className="size-2.5" />
                  {roleLabels[membre.user.role] ?? membre.user.role}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("membres.detail.memberSince", { date: format(new Date(membre.joinedAt), "MMMM yyyy", { locale: fr }) })}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {modules.cotisations && (
              <Button size="sm" variant="outline" onClick={() => setCreateCotisationOpen(true)}>
                <PlusIcon className="mr-1.5 size-4" />
                {t("membres.detail.cotisationButton")}
              </Button>
            )}
            {!membre.userId && membre.email && (
              <Button size="sm" variant="outline" onClick={handleCreateAccess} loading={createAccessMutation.isPending}>
                <KeyIcon className="mr-1.5 size-4" />
                {t("membres.detail.createAccessButton")}
              </Button>
            )}
            {/* Role changes are ADMIN/PRESIDENT-only server-side (see membres/[id]/role/route.ts)
                — matching that here instead of the broader isManager() avoids showing an action
                a Trésorier/Secrétaire could open but never actually save. */}
            {(currentUser.role === "ADMIN" || currentUser.role === "PRESIDENT") && membre.userId && !isSelf && (
              <Button size="sm" variant="outline" onClick={() => setRoleOpen(true)}>
                <ShieldIcon className="mr-1.5 size-4" />
                {t("membres.detail.roleButton")}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <PencilSimpleIcon className="mr-1.5 size-4" />
              {t("common.edit")}
            </Button>
            {!isSelf && (
              <Button size="sm" variant="outline" onClick={() => setDeleteOpen(true)}>
                <TrashIcon className="mr-1.5 size-4" />
                {t("common.delete")}
              </Button>
            )}
          </div>
        </div>

        {/* Approving a request used to mean opening the edit modal and changing a dropdown —
            an action nothing on the page announced. Shown for any PENDING membre, not only one
            carrying a pendingTier: a PENDING created by another path (site membership section,
            manual creation) needs the same way out. */}
        {membre.status === "PENDING" && !isSelf && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t("membres.detail.pendingRequest.title")}</p>
              <p className="text-xs text-muted-foreground">
                {membre.pendingTier
                  ? t("membres.detail.pendingRequest.withTier", { tier: membre.pendingTier.label })
                  : t("membres.detail.pendingRequest.description")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleApprove} loading={updateMutation.isPending}>
                <CheckIcon className="mr-1.5 size-4" />
                {t("membres.detail.pendingRequest.approve")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRejectOpen(true)}>
                {t("membres.detail.pendingRequest.reject")}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("membres.detail.contact")}</p>
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
            <p className="text-muted-foreground">{t("membres.detail.noContactInfo")}</p>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("membres.form.fields.status")}</p>
          <p className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarIcon className="size-3.5" />
            {t("membres.detail.memberSinceColon", { date: format(new Date(membre.joinedAt), "dd/MM/yyyy", { locale: fr }) })}
          </p>
          {membre.type && <p className="text-muted-foreground">{t("membres.detail.typeColon", { name: membre.type.name })}</p>}
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("membres.detail.personalInfo")}</p>
          {membre.civilite && (
            <p className="text-muted-foreground">{t("membres.detail.civiliteColon", { value: civiliteLabels[membre.civilite] ?? membre.civilite })}</p>
          )}
          {membre.sexe && (
            <p className="text-muted-foreground">{t("membres.detail.sexeColon", { value: sexeLabels[membre.sexe] ?? membre.sexe })}</p>
          )}
          {membre.birthDate && (
            <p className="text-muted-foreground">{t("membres.detail.birthColon", { date: format(new Date(membre.birthDate), "dd/MM/yyyy", { locale: fr }) })}</p>
          )}
          {membre.groupeSanguin && (
            <p className="text-muted-foreground">{t("membres.detail.groupeSanguinColon", { value: GROUPE_SANGUIN_LABELS[membre.groupeSanguin] ?? membre.groupeSanguin })}</p>
          )}
          {membre.possedeTshirt !== null && (
            <p className="text-muted-foreground">{t("membres.detail.hasTshirtColon", { value: membre.possedeTshirt ? t("common.yes") : t("common.no") })}</p>
          )}
          {membre.tailleTshirt && (
            <p className="text-muted-foreground">{t("membres.detail.tshirtSizeColon", { value: TAILLE_TSHIRT_LABELS[membre.tailleTshirt] ?? membre.tailleTshirt })}</p>
          )}
          {membre.spokenLanguage && (
            <p className="text-muted-foreground">{t("membres.detail.spokenLanguageColon", { value: spokenLanguageLabel(membre.spokenLanguage) })}</p>
          )}
          {membre.allergies && (
            <p className="flex items-start gap-1.5 text-muted-foreground">
              <WarningIcon className="size-3.5 mt-0.5 shrink-0" />
              <span>{t("membres.detail.allergiesColon", { value: membre.allergies })}</span>
            </p>
          )}
          {membre.responsable && (
            <p className="text-muted-foreground">
              {t("membres.detail.legalGuardianColon")}{" "}
              <button
                type="button"
                onClick={() => router.push(`/dashboard/membres/${membre.responsable!.id}`)}
                className="text-foreground underline-offset-2 hover:underline"
              >
                {membre.responsable.firstName} {membre.responsable.lastName}
              </button>
            </p>
          )}
          {membre.mobile && (
            <p className="flex items-center gap-1.5 text-muted-foreground"><PhoneIcon className="size-3.5" />{t("membres.detail.mobileColon", { value: membre.mobile })}</p>
          )}
          {membre.customFieldAnswers.map((a, i) => (
            <p key={i} className="text-muted-foreground">{a.label} : {a.value}</p>
          ))}
          {!membre.civilite && !membre.sexe && !membre.birthDate && !membre.groupeSanguin && !membre.allergies
            && membre.possedeTshirt === null && !membre.tailleTshirt && !membre.responsable && !membre.spokenLanguage
            && !membre.mobile && membre.customFieldAnswers.length === 0 && (
            <p className="text-muted-foreground">{t("membres.detail.noInfo")}</p>
          )}
        </div>

        <div className="rounded-lg border bg-card p-4 space-y-2.5 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("membres.detail.accountAccess")}</p>
          {membre.userId ? (
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <UserIcon className="size-3.5" />
              {t("membres.detail.activeAccount", { role: roleLabels[membre.user?.role ?? "MEMBRE"] })}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {membre.email ? t("membres.detail.noAccountWithEmail") : t("membres.detail.noAccountNoEmail")}
            </p>
          )}
          {membre.dependants.length > 0 && (
            <div className="pt-1">
              <p className="text-muted-foreground">{t("membres.detail.dependantsTitle")}</p>
              <ul className="mt-1 space-y-1">
                {membre.dependants.map(d => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => router.push(`/dashboard/membres/${d.id}`)}
                      className="text-foreground underline-offset-2 hover:underline"
                    >
                      {d.firstName} {d.lastName}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {membre.cotisationSubscription && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("membres.detail.recurringSubscription")}</span>
            <span className="flex items-center gap-2">
              <span className="font-medium tabular-nums">{t("membres.detail.recurringSubscriptionAmount", { amount: fmt(membre.cotisationSubscription.amount) })}</span>
              <Badge variant={subscriptionStatusBadge[membre.cotisationSubscription.status].variant}>
                {subscriptionStatusBadge[membre.cotisationSubscription.status].label}
              </Badge>
            </span>
            {membre.cotisationSubscription.status !== "CANCELLED" && membre.cotisationSubscription.currentPeriodEndsAt && (
              <span className="text-muted-foreground">
                {t("membres.detail.recurringSubscriptionNextCharge", { date: format(new Date(membre.cotisationSubscription.currentPeriodEndsAt), "dd/MM/yyyy", { locale: fr }) })}
              </span>
            )}
          </div>
          {membre.cotisationSubscription.status !== "CANCELLED"
            && (currentUser.role === "ADMIN" || currentUser.role === "PRESIDENT" || currentUser.role === "TRESORIER") && (
            <Button size="sm" variant="outline" onClick={() => setCancelSubscriptionOpen(true)}>
              {t("membres.detail.cancelSubscriptionButton")}
            </Button>
          )}
        </div>
      )}

      <Tabs defaultValue={modules.cotisations ? "cotisations" : modules.evenements ? "evenements" : modules.reunions ? "reunions" : modules.materiel ? "materiel" : "historique"}>
        <TabsList>
          {modules.cotisations && <TabsTrigger value="cotisations">{t("membres.detail.tabs.cotisations")}</TabsTrigger>}
          {modules.evenements && <TabsTrigger value="evenements">{t("membres.detail.tabs.evenements")}</TabsTrigger>}
          {modules.reunions && <TabsTrigger value="reunions">{t("membres.detail.tabs.reunions")}</TabsTrigger>}
          {modules.materiel && <TabsTrigger value="materiel">{t("membres.detail.tabs.materiel")}</TabsTrigger>}
          <TabsTrigger value="historique">{t("membres.detail.tabs.historique")}</TabsTrigger>
          <TabsTrigger value="emails">{t("membres.detail.tabs.emails")}</TabsTrigger>
          {modules.sms && <TabsTrigger value="sms">{t("membres.detail.tabs.sms")}</TabsTrigger>}
        </TabsList>

        {modules.cotisations && (
        <TabsContent value="cotisations" className="pt-3">
          {cotisations.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("membres.detail.noCotisation")}</p>
          ) : (
            <div className="space-y-2">
              {cotisations.map((c: {
                id: string; year: number; amount: string; status: string; paidAt: string | null
                declarationNumber: string | null; periodEnd?: string | null; receiptMode?: "NONE" | "FULL" | "PARTIAL"
                deductibleAmount?: string | null
                installmentPlan?: { id: string; status: string; installmentsPaid: number; installmentsCount: number } | null
              }) => {
                const s = cotisationStatusBadge[c.status]
                // A custom-duration Cotisation (MembershipTier.durationMonths) keeps its PAYE/
                // EXONERE badge forever — cotisation-status-sweep deliberately never touches a
                // terminal status — so the badge alone can't tell an admin this row's validity
                // window has actually closed. Surfaced here instead of silently trusting the
                // badge, same value isMembreAdherent() already uses to decide the member's own
                // overall status.
                const periodEndDate = c.periodEnd ? new Date(c.periodEnd) : null
                const periodExpired = !!periodEndDate && periodEndDate < new Date()
                return (
                  <div key={c.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-sm">
                    <div>
                      <p className="font-medium tabular-nums">{c.year}</p>
                      {c.paidAt && <p className="text-xs text-muted-foreground">{t("membres.detail.paidOn", { date: format(new Date(c.paidAt), "dd/MM/yyyy", { locale: fr }) })}</p>}
                      {periodEndDate && (
                        <p className={cn("text-xs", periodExpired ? "text-destructive" : "text-muted-foreground")}>
                          {t(periodExpired ? "membres.detail.periodExpiredOn" : "membres.detail.validUntil", { date: format(periodEndDate, "dd/MM/yyyy", { locale: fr }) })}
                        </p>
                      )}
                      {c.installmentPlan && (
                        <p className="text-xs text-muted-foreground">
                          {t("membres.detail.installmentProgress", { paid: c.installmentPlan.installmentsPaid, total: c.installmentPlan.installmentsCount })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums font-medium">{fmt(c.amount)}</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex" />}>
                            <Badge variant={s.variant}>{s.label}</Badge>
                          </TooltipTrigger>
                          <TooltipContent>{s.tooltip}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {c.declarationNumber && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(`${BASE_PATH}/api/membres/${id}/cotisations/${c.id}/declaration`)}
                        >
                          <DownloadSimpleIcon className="size-3.5" />
                        </Button>
                      )}
                      {c.receiptMode && c.receiptMode !== "NONE" && c.paidAt && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger render={
                              <Button size="sm" variant="outline" onClick={() => downloadCotisationRecu(c.id)}>
                                <ReceiptIcon className="size-3.5" />
                              </Button>
                            } />
                            <TooltipContent>
                              {c.receiptMode === "PARTIAL" && c.deductibleAmount
                                ? t("membres.detail.downloadRecuFiscalPartial", { amount: fmt(c.deductibleAmount) })
                                : t("membres.detail.downloadRecuFiscal")}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {c.installmentPlan?.status === "ACTIVE" && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger render={
                              <Button size="sm" variant="outline" onClick={() => setCancelInstallmentOpen(true)}>
                                <XCircleIcon className="size-3.5" />
                              </Button>
                            } />
                            <TooltipContent>{t("membres.detail.cancelInstallmentButton")}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {cotisationsTotal > TAB_PAGE_SIZE && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("membres.detail.showingRecentCotisations", { count: TAB_PAGE_SIZE, total: cotisationsTotal })}
            </p>
          )}
          {addonPurchases.length > 0 && (
            <div className="mt-4 space-y-1.5 border-t pt-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("membres.detail.addonPurchasesTitle")}</p>
              <div className="space-y-1">
                {addonPurchases.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span>{p.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums font-medium">{fmt(p.amount)}</span>
                      {p.date ? (
                        <span className="text-xs text-muted-foreground">{format(new Date(p.date), "dd/MM/yyyy", { locale: fr })}</span>
                      ) : (
                        // Only a don paid offline (ESPECES/CHEQUE/VIREMENT) reaches this list with no
                        // date — MembershipAddonPurchase always has purchasedAt. Surfaces the pending
                        // encaissement here too, next to the member's own cotisations above, so an
                        // admin reconciling a single physical payment (e.g. one cheque covering both)
                        // sees both pending items on the same screen instead of only in /dashboard/dons.
                        <span className="text-xs text-muted-foreground">{t("membres.detail.addonPurchasePending")}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>
        )}

        {modules.evenements && (
        <TabsContent value="evenements" className="pt-3">
          {participations.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("membres.detail.noParticipation")}</p>
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
                    {p.present && <Badge variant="default">{t("membres.detail.present")}</Badge>}
                    {p.rsvp && <RsvpBadge rsvp={p.rsvp} />}
                  </div>
                </button>
              ))}
            </div>
          )}
          {participationsTotal > TAB_PAGE_SIZE && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("membres.detail.showingRecentParticipations", { count: TAB_PAGE_SIZE, total: participationsTotal })}
            </p>
          )}
        </TabsContent>
        )}

        {modules.reunions && (
        <TabsContent value="reunions" className="pt-3">
          {meetingsAsParticipant.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("membres.detail.noMeeting")}</p>
          ) : (
            <div className="space-y-2">
              {meetingsAsParticipant.map((mp) => {
                // scheduledAt is null for "start now" instant meetings — fall back to
                // createdAt (always set) rather than showing no date at all, same anchor
                // reunions-view.tsx uses for its own date label.
                const anchor = mp.meeting.scheduledAt ?? mp.meeting.createdAt
                return (
                  <button
                    key={mp.id}
                    type="button"
                    onClick={() => router.push(`/dashboard/reunions/${mp.meeting.id}`)}
                    className="flex w-full items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-left text-sm hover:bg-muted/40 transition-colors"
                  >
                    <div>
                      <p className="font-medium">{mp.meeting.title}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(anchor), "dd/MM/yyyy", { locale: fr })}</p>
                    </div>
                    {mp.meeting.status === "ENDED" ? (
                      mp.joinedAt
                        ? <Badge variant="default">{t("membres.detail.participated")}</Badge>
                        : <Badge variant="secondary">{t("membres.detail.notParticipated")}</Badge>
                    ) : (
                      <Badge variant={meetingStatusBadge[mp.meeting.status].variant}>{meetingStatusBadge[mp.meeting.status].label}</Badge>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          {meetingsTotal > TAB_PAGE_SIZE && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("membres.detail.showingRecentMeetings", { count: TAB_PAGE_SIZE, total: meetingsTotal })}
            </p>
          )}
        </TabsContent>
        )}

        {modules.materiel && (
        <TabsContent value="materiel" className="pt-3">
          {materialLoans.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t("membres.detail.noLoan")}</p>
          ) : (
            <div className="space-y-2">
              {materialLoans.map((l: { id: string; status: string; quantity: number; borrowedAt: string; returnedAt: string | null; material: { name: string } }) => {
                const s = loanStatusBadge[l.status]
                return (
                  <div key={l.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-sm">
                    <div>
                      <p className="font-medium">{l.material.name}{l.quantity > 1 && <span className="text-muted-foreground font-normal"> · x{l.quantity}</span>}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("membres.detail.borrowedOn", { date: format(new Date(l.borrowedAt), "dd/MM/yyyy", { locale: fr }) })}
                        {l.returnedAt && t("membres.detail.returnedOn", { date: format(new Date(l.returnedAt), "dd/MM/yyyy", { locale: fr }) })}
                      </p>
                    </div>
                    <Badge variant={l.returnedAt ? "secondary" : s.variant}>{l.returnedAt ? t("membres.detail.loanStatus.returned") : s.label}</Badge>
                  </div>
                )
              })}
            </div>
          )}
          {materialLoansTotal > TAB_PAGE_SIZE && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("membres.detail.showingRecentLoans", { count: TAB_PAGE_SIZE, total: materialLoansTotal })}
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

        {modules.sms && (
        <TabsContent value="sms" className="pt-3">
          <MembreSmsLog membreId={id} />
        </TabsContent>
        )}
      </Tabs>

      <Modal open={editOpen} onOpenChange={setEditOpen} title={t("membres.actions.edit")} size="lg" dismissable={false}>
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
            sexe:          membre.sexe          ?? "",
            groupeSanguin: membre.groupeSanguin ?? "",
            allergies:     membre.allergies     ?? "",
            photoUrl:      membre.photoUrl      ?? "",
            preferredLocale: (membre.preferredLocale ?? "") as MembreInput["preferredLocale"],
            spokenLanguage:  (membre.spokenLanguage  ?? "") as MembreInput["spokenLanguage"],
            possedeTshirt: membre.possedeTshirt === null ? "" : String(membre.possedeTshirt) as "true" | "false",
            tailleTshirt:  membre.tailleTshirt  ?? "",
            responsableId: membre.responsableId ?? "",
            adherentOverride: membre.adherentOverride === null ? "" : String(membre.adherentOverride) as "true" | "false",
          }}
          onSubmit={handleUpdate}
          onCancel={() => setEditOpen(false)}
          loading={updateMutation.isPending}
          actorRole={currentUser.role}
          isSelf={isSelf}
          membreId={membre.id}
        />
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("membres.actions.deleteConfirmTitle", { name: `${membre.firstName} ${membre.lastName}` })}
        description={membre.dependants.length > 0
          ? t("membres.detail.deleteConfirmWithDependants", {
              count: membre.dependants.length,
              names: membre.dependants.map(d => `${d.firstName} ${d.lastName}`).join(", "),
            })
          : t("membres.view.deleteConfirmDescription")}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title={t("membres.detail.pendingRequest.rejectConfirmTitle")}
        description={t("membres.detail.pendingRequest.rejectConfirmDescription", { name: `${membre.firstName} ${membre.lastName}` })}
        confirmLabel={t("membres.detail.pendingRequest.reject")}
        loading={updateMutation.isPending}
        onConfirm={handleReject}
      />

      <ConfirmDialog
        open={cancelSubscriptionOpen}
        onOpenChange={setCancelSubscriptionOpen}
        title={t("membres.detail.cancelSubscriptionConfirmTitle")}
        description={t("membres.detail.cancelSubscriptionConfirmDescription", { name: `${membre.firstName} ${membre.lastName}` })}
        confirmLabel={t("membres.detail.cancelSubscriptionButton")}
        loading={cancelSubscriptionMutation.isPending}
        onConfirm={handleCancelSubscription}
      />

      <ConfirmDialog
        open={cancelInstallmentOpen}
        onOpenChange={setCancelInstallmentOpen}
        title={t("membres.detail.cancelInstallmentConfirmTitle")}
        description={t("membres.detail.cancelInstallmentConfirmDescription", { name: `${membre.firstName} ${membre.lastName}` })}
        confirmLabel={t("membres.detail.cancelInstallmentButton")}
        loading={cancelInstallmentMutation.isPending}
        onConfirm={handleCancelInstallment}
      />

      {roleOpen && (
        <ChangeRoleModal
          membre={membre}
          onClose={() => setRoleOpen(false)}
        />
      )}

      <Modal open={createCotisationOpen} onOpenChange={setCreateCotisationOpen} title={t("membres.detail.addCotisationTitle")} size="lg" dismissable={false}>
        <CotisationForm
          membres={[]}
          editMode
          defaultValues={{ membreId: id, year: new Date().getFullYear(), status: null }}
          onSubmit={handleCreateCotisation}
          onCancel={() => setCreateCotisationOpen(false)}
          loading={createCotisationMutation.isPending}
        />
      </Modal>

      <Modal
        open={!!editCotisationTarget}
        onOpenChange={(open) => !open && setEditCotisationTarget(null)}
        title={t("membres.detail.editCotisationTitle")}
        size="lg"
        dismissable={false}
      >
        <CotisationForm
          membres={[]}
          editMode
          amountPaid={editCotisationTarget ? Number(editCotisationTarget.amountPaid) : 0}
          currentStatus={editCotisationTarget?.status}
          defaultValues={editCotisationTarget ? {
            membreId:     id,
            year:         editCotisationTarget.year,
            amount:       parseFloat(editCotisationTarget.amount),
            status:       editCotisationTarget.status === "EXONERE" || editCotisationTarget.status === "ANNULEE" ? editCotisationTarget.status : null,
            dueDate:      editCotisationTarget.dueDate ? editCotisationTarget.dueDate.split("T")[0] : "",
            installments: editCotisationTarget.installments.map(i => ({ amount: parseFloat(i.amount), dueDate: i.dueDate.split("T")[0] })),
            note:         editCotisationTarget.note ?? "",
          } : undefined}
          onSubmit={handleUpdateCotisation}
          onCancel={() => setEditCotisationTarget(null)}
          loading={updateCotisationMutation.isPending}
        />
      </Modal>
    </div>
  )
}
