"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { ApiError } from "@/lib/api-error"
import { MEMBER_LIMIT_ERROR_CODE } from "@/lib/api-error-codes"
import { exportMembresPdf } from "@/lib/pdf/membres-export-client"
import { PlusIcon, PencilSimpleIcon, TrashIcon, ClockCounterClockwiseIcon, ShieldIcon, KeyIcon, EyeIcon, CaretDownIcon, ChartBarIcon, PaperPlaneTiltIcon, ArrowsDownUpIcon } from "@phosphor-icons/react/dist/ssr";
import { useMembresPaginated, useCreateMembre, useUpdateMembre, useDeleteMembre, useChangeRole, useCreateAccess } from "@/hooks/use-membres"
import { useMembreTypes } from "@/hooks/use-membre-types"
import type { MembreInput, MembreCreateInput } from "@/lib/schemas"
import { MembreTypeBadge } from "@/components/ui/membre-type-badge"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { MembreForm } from "@/components/membres/membre-form"
import { MembreActivityLog } from "@/components/membres/membre-activity-log"
import { SendEmailModal } from "@/components/membres/send-email-modal"
import { SendSmsModal } from "@/components/membres/send-sms-modal"
import { MembresStatsModal, type MembresStats } from "@/components/membres/membres-stats-modal"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchInput } from "@/components/ui/search-input"
import { FilterSelect } from "@/components/ui/filter-select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useCurrentUser, useModules } from "@/lib/user-context"
import { BASE_PATH } from "@/lib/env"


type MembreTypeRef = { id: string; name: string; color: string }

type UserRole = "ADMIN" | "PRESIDENT" | "TRESORIER" | "SECRETAIRE" | "MEMBRE"

type Membre = {
  id:            string
  photoUrl:      string | null
  firstName:     string
  lastName:      string
  email:         string | null
  phone:         string | null
  address:       string | null
  birthDate:     string | null
  civilite:      "MME" | "MLLE" | "M" | null
  sexe:          "HOMME" | "FEMME" | null
  groupeSanguin: "A_POSITIF" | "A_NEGATIF" | "B_POSITIF" | "B_NEGATIF" | "AB_POSITIF" | "AB_NEGATIF" | "O_POSITIF" | "O_NEGATIF" | null
  allergies:     string | null
  preferredLocale: string | null
  spokenLanguage: string | null
  possedeTshirt: boolean | null
  tailleTshirt:  "XS" | "S" | "M" | "L" | "XL" | "XXL" | "XXXL" | null
  status:        "PENDING" | "ACTIF" | "INACTIF" | "SUSPENDU"
  adherentOverride: boolean | null
  isAdherent:       boolean
  typeId:        string | null
  type:          MembreTypeRef | null
  responsableId: string | null
  joinedAt:      string
  userId:        string | null
  user:          { role: UserRole } | null
}

type Translator = ReturnType<typeof useTranslations>

function getRoleLabels(t: Translator): Record<UserRole, string> {
  return {
    ADMIN:      t("membres.form.role.admin"),
    PRESIDENT:  t("membres.form.role.president"),
    TRESORIER:  t("membres.form.role.tresorier"),
    SECRETAIRE: t("membres.form.role.secretaire"),
    MEMBRE:     t("membres.form.role.membre"),
  }
}

function getRoleOptions(t: Translator): { value: UserRole; label: string }[] {
  return [
    { value: "MEMBRE",     label: t("membres.form.role.membre")     },
    { value: "SECRETAIRE", label: t("membres.form.role.secretaire") },
    { value: "TRESORIER",  label: t("membres.form.role.tresorier")  },
    { value: "PRESIDENT",  label: t("membres.form.role.president")  },
    { value: "ADMIN",      label: t("membres.form.role.admin")      },
  ]
}

function getStatusBadge(t: Translator): Record<Membre["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> {
  return {
    PENDING:  { label: t("membres.form.status.pending"),  variant: "outline"     },
    ACTIF:    { label: t("membres.form.status.actif"),    variant: "default"     },
    INACTIF:  { label: t("membres.form.status.inactif"),  variant: "secondary"   },
    SUSPENDU: { label: t("membres.form.status.suspendu"), variant: "destructive" },
  }
}

export function ChangeRoleModal({
  membre,
  onClose,
}: {
  membre: Membre
  onClose: () => void
}) {
  const t = useTranslations()
  const [role, setRole] = useState<UserRole>(membre.user?.role ?? "MEMBRE")
  const mutation        = useChangeRole()
  const currentUser     = useCurrentUser()

  const allRoleOptions = getRoleOptions(t)
  const roleOptions = currentUser.role === "ADMIN"
    ? allRoleOptions
    : allRoleOptions.filter(o => o.value !== "ADMIN")

  async function handleSave() {
    try {
      await mutation.mutateAsync({ id: membre.id, role })
      toast.success(t("membres.view.toasts.roleUpdated"))
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  return (
    <Modal open onOpenChange={open => { if (!open) onClose() }} title={t("membres.view.changeRoleTitle")}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("membres.view.changeRoleDescription", { name: `${membre.firstName} ${membre.lastName}` })}
        </p>
        <Select value={role} onValueChange={v => setRole(v as UserRole)}>
          <SelectTrigger>
            <SelectValue>{roleOptions.find(o => o.value === role)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>{t("common.cancel")}</Button>
          <Button onClick={handleSave} loading={mutation.isPending}>{t("common.save")}</Button>
        </div>
      </div>
    </Modal>
  )
}

const PAGE_SIZE = 20

export function MembresView() {
  const t                               = useTranslations()
  const router                          = useRouter()
  const currentUser                     = useCurrentUser()
  const modules                         = useModules()
  const [page, setPage]                 = useState(1)
  const [searchInput, setSearchInput]   = useState("")
  const [search, setSearch]             = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [typeFilter, setTypeFilter]     = useState<string>("")
  const [adherentFilter, setAdherentFilter] = useState<string>("")
  const [createOpen, setCreateOpen]       = useState(false)
  const [editTarget, setEditTarget]       = useState<Membre | null>(null)
  const [deleteTarget, setDeleteTarget]   = useState<Membre | null>(null)
  const [emailOpen, setEmailOpen]         = useState(false)
  const [smsOpen,   setSmsOpen]           = useState(false)
  const [statsOpen, setStatsOpen]         = useState(false)
  const [historyTarget, setHistoryTarget] = useState<Membre | null>(null)
  const [roleTarget, setRoleTarget]       = useState<Membre | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function buildExportParams(){
    const params = new URLSearchParams()
    if (search)       params.set("search", search)
    if (statusFilter) params.set("status", statusFilter)
    if (typeFilter)   params.set("typeId", typeFilter)
    return params
  }

  function handleExportXlsx() {
    if (!result?.total) {
      toast.error(t("membres.view.toasts.noMembersToExport"))
      return
    }
    const params = buildExportParams()
    params.set("format", "xlsx")
    window.location.href = `${BASE_PATH}/api/membres/export?${params}`
  }

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  const { data: types = [] } = useMembreTypes()
  const { data: result, isLoading } = useMembresPaginated(page, PAGE_SIZE, search || undefined, statusFilter || undefined, typeFilter || undefined, adherentFilter || undefined)
  const { data: stats } = useQuery<MembresStats>({
    queryKey: ["membres", "stats"],
    queryFn:  () => fetch("/api/membres/stats").then(r => r.json()),
    enabled:  statsOpen,
  })
  const membres = (result?.data ?? []) as Membre[]

  useEffect(() => {
    if (result && result.totalPages > 0 && page > result.totalPages) setPage(result.totalPages)
  }, [result, page])

  const createMutation      = useCreateMembre()
  const updateMutation      = useUpdateMembre(editTarget?.id ?? "")
  const deleteMutation      = useDeleteMembre()
  const createAccessMutation = useCreateAccess()

  async function handleCreateAccess(m: Membre) {
    try {
      await createAccessMutation.mutateAsync(m.id)
      toast.success(t("membres.view.toasts.accessCreated", { name: `${m.firstName} ${m.lastName}` }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleCreate(data: MembreCreateInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success(t("membres.view.toasts.memberAdded"))
      setCreateOpen(false)
    } catch (err) {
      if (err instanceof ApiError && err.code === MEMBER_LIMIT_ERROR_CODE) {
        toast.error(err.message, {
          action: {
            label:   t("membres.view.toasts.viewSubscription"),
            onClick: () => router.push("/dashboard/parametres?tab=abonnement"),
          },
        })
        return
      }
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUpdate(data: MembreInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t("membres.view.toasts.memberUpdated"))
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      const { unlinkedDependants } = await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success(unlinkedDependants > 0
        ? t("membres.view.toasts.memberDeletedWithUnlink", { count: unlinkedDependants })
        : t("membres.view.toasts.memberDeleted"))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const roleLabels = getRoleLabels(t)
  const statusBadge = getStatusBadge(t)

  const columns: Column<Membre>[] = [
    {
      key: "name",
      header: t("membres.view.columns.member"),
      cell: (m) => (
        <div className="flex items-center gap-2.5">
          {m.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={m.photoUrl}
              alt=""
              className="size-8 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="size-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0">
              {m.firstName[0]}{m.lastName[0]}
            </div>
          )}
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
              <p className="font-medium">{m.lastName} {m.firstName}</p>
              {m.type && <MembreTypeBadge name={m.type.name} color={m.type.color} />}
              {m.user && m.user.role !== "MEMBRE" && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">{roleLabels[m.user.role]}</span>
              )}
            </div>
            {m.email && <p className="text-xs text-muted-foreground truncate">{m.email}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "phone",
      header: t("membres.view.columns.phone"),
      cell: (m) => m.phone ?? <span className="text-muted-foreground text-xs">—</span>,
      hideInCard: true,
    },
    {
      key: "joinedAt",
      header: t("membres.view.columns.memberSince"),
      cell: (m) => <span className="text-muted-foreground">{format(new Date(m.joinedAt), "MMM yyyy", { locale: fr })}</span>,
      hideInCard: true,
    },
    {
      key: "status",
      header: t("membres.view.columns.status"),
      cell: (m) => {
        const s = statusBadge[m.status]
        return <Badge variant={s.variant}>{s.label}</Badge>
      },
    },
    ...(modules.cotisations ? [{
      key: "adherent",
      header: t("membres.view.columns.membership"),
      cell: (m: Membre) => (
        m.isAdherent
          ? <span>{t("membres.view.membershipAdherent")}</span>
          : <span className="text-muted-foreground">{t("membres.view.membershipBenevole")}</span>
      ),
    }] : []),
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (m) => {
        const isSelf = m.userId === currentUser.id
        return (
          <RowActions actions={[
            { label: t("membres.view.actions.view"), icon: <EyeIcon className="size-3.5" />, onClick: () => router.push(`/dashboard/membres/${m.id}`) },
            { label: t("membres.view.actions.edit"),   icon: <PencilSimpleIcon  className="size-3.5" />, onClick: () => setEditTarget(m) },
            { label: t("membres.view.actions.history"), icon: <ClockCounterClockwiseIcon className="size-3.5" />, onClick: () => setHistoryTarget(m) },
            ...((currentUser.role === "ADMIN" || currentUser.role === "PRESIDENT") && m.userId && !isSelf ? [
              { label: t("membres.view.actions.changeRole"), icon: <ShieldIcon className="size-3.5" />, onClick: () => setRoleTarget(m) },
            ] : []),
            ...(!m.userId && m.email ? [
              { label: t("membres.view.actions.createAccess"), icon: <KeyIcon className="size-3.5" />, onClick: () => handleCreateAccess(m) },
            ] : []),
            ...(!isSelf ? [
              { label: t("membres.view.actions.delete"), icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(m) },
            ] : []),
          ]} />
        )
      },
    },
  ]

  const descriptionText = search
    ? t("membres.view.resultsCount", { count: result?.total ?? 0 })
    : t("membres.view.membersCount", { count: result?.total ?? 0 })

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("membres.view.title")}
        description={descriptionText}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label={t("membres.view.stats")}
                      onClick={() => setStatsOpen(true)}
                    />
                  }
                >
                  <ChartBarIcon />
                </TooltipTrigger>
                <TooltipContent>{t("membres.view.stats")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="outline" aria-label={t("membres.view.communication")} />}>
                <PaperPlaneTiltIcon className="size-4 sm:hidden" />
                <span className="hidden sm:inline">{t("membres.view.communication")}</span>
                <CaretDownIcon className="ml-1 size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEmailOpen(true)}>
                  {t("membres.view.sendEmail")}
                </DropdownMenuItem>
                {modules.sms && (
                  <DropdownMenuItem onClick={() => setSmsOpen(true)}>
                    {t("membres.view.sendSms")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="outline" aria-label={t("membres.view.data")} />}>
                <ArrowsDownUpIcon className="size-4 sm:hidden" />
                <span className="hidden sm:inline">{t("membres.view.data")}</span>
                <CaretDownIcon className="ml-1 size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => router.push("/dashboard/membres/import")}>
                    {t("membres.importWizard.title")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{t("membres.view.export")}</DropdownMenuLabel>
                  <DropdownMenuItem onClick={handleExportXlsx}>
                    {t("membres.view.exportExcel")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportMembresPdf(buildExportParams())}>
                    {t("membres.view.exportPdf")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => window.open(`${BASE_PATH}/api/membres/fiche-vierge`, "_blank")}>
                    {t("membres.view.blankFormPdf")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="mr-1.5 size-4" />
              {t("common.add")}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <SearchInput
          placeholder={t("membres.view.searchPlaceholder")}
          value={searchInput}
          onValueChange={handleSearch}
          onClear={() => {
            if (debounceRef.current) clearTimeout(debounceRef.current)
            setSearchInput("")
            setSearch("")
            setPage(1)
          }}
          containerClassName="w-72"
        />

        <FilterSelect
          value={statusFilter}
          onValueChange={v => { setStatusFilter(v); setPage(1) }}
          options={[
            { value: "PENDING",  label: t("membres.view.statusOptions.pending")   },
            { value: "ACTIF",    label: t("membres.view.statusOptions.actifs")    },
            { value: "INACTIF",  label: t("membres.view.statusOptions.inactifs")  },
            { value: "SUSPENDU", label: t("membres.view.statusOptions.suspendus") },
          ]}
          placeholder={t("membres.view.allStatuses")}
          width="w-40"
        />

        {types.length > 0 && (
          <FilterSelect
            value={typeFilter}
            onValueChange={v => { setTypeFilter(v); setPage(1) }}
            options={types.map(type => ({ value: type.id, label: type.name }))}
            placeholder={t("membres.view.allTypes")}
            width="w-40"
          />
        )}

        {modules.cotisations && (
          <FilterSelect
            value={adherentFilter}
            onValueChange={v => { setAdherentFilter(v); setPage(1) }}
            options={[
              { value: "ADHERENT", label: t("membres.view.adherentOptions.adherents") },
              { value: "BENEVOLE", label: t("membres.view.adherentOptions.benevoles")  },
            ]}
            placeholder={t("membres.view.allMembership")}
            width="w-40"
          />
        )}
      </div>

      <DataTable
        columns={columns}
        data={membres}
        loading={isLoading}
        keyExtractor={(m) => m.id}
        empty={search ? t("membres.view.noResultsFor", { search }) : t("membres.view.noMembers")}
        onRowClick={(m) => router.push(`/dashboard/membres/${m.id}`)}
        pagination={result ? {
          page:         result.page,
          totalPages:   result.totalPages,
          total:        result.total,
          limit:        result.limit,
          onPageChange: (p) => setPage(p),
        } : undefined}
      />

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t("membres.actions.add")}
        size="lg"
        dismissable={false}
      >
        <MembreForm
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
          isCreate
          actorRole={currentUser.role}
        />
      </Modal>

      <Modal
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        title={t("membres.actions.edit")}
        size="lg"
        dismissable={false}
      >
        <MembreForm
          defaultValues={editTarget ? {
            firstName: editTarget.firstName,
            lastName:  editTarget.lastName,
            email:     editTarget.email     ?? "",
            phone:     editTarget.phone     ?? "",
            birthDate: editTarget.birthDate ? editTarget.birthDate.split("T")[0] : "",
            status:    editTarget.status,
            typeId:    editTarget.typeId    ?? "",
            civilite:      editTarget.civilite      ?? "",
            sexe:          editTarget.sexe          ?? "",
            groupeSanguin: editTarget.groupeSanguin ?? "",
            allergies:     editTarget.allergies     ?? "",
            photoUrl:      editTarget.photoUrl      ?? "",
            preferredLocale: (editTarget.preferredLocale ?? "") as MembreInput["preferredLocale"],
            spokenLanguage:  (editTarget.spokenLanguage  ?? "") as MembreInput["spokenLanguage"],
            possedeTshirt: editTarget.possedeTshirt === null ? "" : String(editTarget.possedeTshirt) as "true" | "false",
            tailleTshirt:  editTarget.tailleTshirt  ?? "",
            responsableId: editTarget.responsableId ?? "",
            adherentOverride: editTarget.adherentOverride === null ? "" : String(editTarget.adherentOverride) as "true" | "false",
          } : undefined}
          onSubmit={handleUpdate}
          onCancel={() => setEditTarget(null)}
          loading={updateMutation.isPending}
          actorRole={currentUser.role}
          isSelf={editTarget?.userId === currentUser.id}
          membreId={editTarget?.id}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t("membres.actions.deleteConfirmTitle", { name: `${deleteTarget?.firstName} ${deleteTarget?.lastName}` })}
        description={t("membres.view.deleteConfirmDescription")}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />

      <SendEmailModal
        open={emailOpen}
        onOpenChange={setEmailOpen}
      />

      <SendSmsModal
        open={smsOpen}
        onOpenChange={setSmsOpen}
      />

      <MembresStatsModal
        open={statsOpen}
        onOpenChange={setStatsOpen}
        stats={stats}
        showMembership={modules.cotisations}
      />

      <Modal
        open={!!historyTarget}
        onOpenChange={(open) => !open && setHistoryTarget(null)}
        title={historyTarget ? t("membres.view.historyTitle", { name: `${historyTarget.firstName} ${historyTarget.lastName}` }) : t("membres.view.historyTitleDefault")}
        size="md"
      >
        {historyTarget && <MembreActivityLog membreId={historyTarget.id} />}
      </Modal>

      {roleTarget && (
        <ChangeRoleModal
          membre={roleTarget}
          onClose={() => setRoleTarget(null)}
        />
      )}
    </div>
  )
}
