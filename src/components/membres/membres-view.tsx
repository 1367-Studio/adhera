"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { PlusIcon, PencilSimpleIcon, TrashIcon, MagnifyingGlassIcon, XIcon, EnvelopeSimpleIcon, ClockCounterClockwiseIcon, ShieldIcon, DeviceMobileIcon, KeyIcon } from "@phosphor-icons/react/dist/ssr";
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
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useCurrentUser, useModules } from "@/lib/user-context"

type MembreTypeRef = { id: string; name: string; color: string }

type UserRole = "ADMIN" | "PRESIDENT" | "TRESORIER" | "SECRETAIRE" | "MEMBRE"

type Membre = {
  id:        string
  firstName: string
  lastName:  string
  email:     string | null
  phone:     string | null
  address:   string | null
  birthDate: string | null
  status:    "PENDING" | "ACTIF" | "INACTIF" | "SUSPENDU"
  typeId:    string | null
  type:      MembreTypeRef | null
  joinedAt:  string
  userId:    string | null
  user:      { role: UserRole } | null
}

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN:      "Admin",
  PRESIDENT:  "Président",
  TRESORIER:  "Trésorier",
  SECRETAIRE: "Secrétaire",
  MEMBRE:     "Membre",
}

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "MEMBRE",     label: "Membre"     },
  { value: "SECRETAIRE", label: "Secrétaire" },
  { value: "TRESORIER",  label: "Trésorier"  },
  { value: "PRESIDENT",  label: "Président"  },
  { value: "ADMIN",      label: "Admin"      },
]

const statusBadge: Record<Membre["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PENDING:  { label: "En attente", variant: "outline"     },
  ACTIF:    { label: "Actif",      variant: "default"     },
  INACTIF:  { label: "Inactif",    variant: "secondary"   },
  SUSPENDU: { label: "Suspendu",   variant: "destructive" },
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder: string
}) {
  const selected = options.find(o => o.value === value)
  return (
    <Select value={value || "__all__"} onValueChange={v => onChange(!v || v === "__all__" ? "" : v)}>
      <SelectTrigger className="w-40">
        <span className={selected ? "text-sm" : "text-sm text-muted-foreground"}>
          {selected?.label ?? placeholder}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{placeholder}</SelectItem>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ChangeRoleModal({
  membre,
  onClose,
}: {
  membre: Membre
  onClose: () => void
}) {
  const [role, setRole] = useState<UserRole>(membre.user?.role ?? "MEMBRE")
  const mutation        = useChangeRole()
  const currentUser     = useCurrentUser()

  const roleOptions = currentUser.role === "ADMIN"
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter(o => o.value !== "ADMIN")

  async function handleSave() {
    try {
      await mutation.mutateAsync({ id: membre.id, role })
      toast.success("Rôle mis à jour")
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  return (
    <Modal open onOpenChange={open => { if (!open) onClose() }} title="Modifier le rôle">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Rôle de <strong>{membre.firstName} {membre.lastName}</strong> dans l'association.
        </p>
        <Select value={role} onValueChange={v => setRole(v as UserRole)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Annuler</Button>
          <Button onClick={handleSave} loading={mutation.isPending}>Enregistrer</Button>
        </div>
      </div>
    </Modal>
  )
}

const PAGE_SIZE = 20

export function MembresView() {
  const currentUser                     = useCurrentUser()
  const modules                         = useModules()
  const [page, setPage]                 = useState(1)
  const [searchInput, setSearchInput]   = useState("")
  const [search, setSearch]             = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [typeFilter, setTypeFilter]     = useState<string>("")
  const [createOpen, setCreateOpen]       = useState(false)
  const [editTarget, setEditTarget]       = useState<Membre | null>(null)
  const [deleteTarget, setDeleteTarget]   = useState<Membre | null>(null)
  const [emailOpen, setEmailOpen]         = useState(false)
  const [smsOpen,   setSmsOpen]           = useState(false)
  const [historyTarget, setHistoryTarget] = useState<Membre | null>(null)
  const [roleTarget, setRoleTarget]       = useState<Membre | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleSearch(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setSearch(val); setPage(1) }, 300)
  }

  const { data: types = [] } = useMembreTypes()
  const { data: result, isLoading } = useMembresPaginated(page, PAGE_SIZE, search || undefined, statusFilter || undefined, typeFilter || undefined)
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
      toast.success(`Accès créé pour ${m.firstName} ${m.lastName} — un email lui a été envoyé`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleCreate(data: MembreCreateInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success("Membre ajouté avec succès")
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleUpdate(data: MembreInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success("Membre mis à jour")
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success("Membre supprimé")
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const columns: Column<Membre>[] = [
    {
      key: "name",
      header: "Membre",
      cell: (m) => (
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium">{m.lastName} {m.firstName}</p>
            {m.type && <MembreTypeBadge name={m.type.name} color={m.type.color} />}
            {m.user && m.user.role !== "MEMBRE" && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 dark:bg-primary/20 text-primary">
                <ShieldIcon className="size-2.5" />
                {ROLE_LABELS[m.user.role]}
              </span>
            )}
          </div>
          {m.email && <p className="text-xs text-muted-foreground">{m.email}</p>}
        </div>
      ),
    },
    {
      key: "phone",
      header: "Téléphone",
      cell: (m) => m.phone ?? <span className="text-muted-foreground text-xs">—</span>,
      hideInCard: true,
    },
    {
      key: "joinedAt",
      header: "Adhésion",
      cell: (m) => format(new Date(m.joinedAt), "MMM yyyy", { locale: fr }),
      hideInCard: true,
    },
    {
      key: "status",
      header: "Statut",
      cell: (m) => {
        const s = statusBadge[m.status]
        return <Badge variant={s.variant}>{s.label}</Badge>
      },
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      cell: (m) => {
        const isSelf = m.userId === currentUser.id
        return (
          <RowActions actions={[
            { label: "Modifier",   icon: <PencilSimpleIcon  className="size-3.5" />, onClick: () => setEditTarget(m) },
            { label: "Historique", icon: <ClockCounterClockwiseIcon className="size-3.5" />, onClick: () => setHistoryTarget(m) },
            ...((currentUser.role === "ADMIN" || currentUser.role === "PRESIDENT") && m.userId && !isSelf ? [
              { label: "Modifier le rôle", icon: <ShieldIcon className="size-3.5" />, onClick: () => setRoleTarget(m) },
            ] : []),
            ...(!m.userId && m.email ? [
              { label: "Créer un accès", icon: <KeyIcon className="size-3.5" />, onClick: () => handleCreateAccess(m) },
            ] : []),
            ...(!isSelf ? [
              { label: "Supprimer", icon: <TrashIcon className="size-3.5" />, destructive: true, separator: true, onClick: () => setDeleteTarget(m) },
            ] : []),
          ]} />
        )
      },
    },
  ]

  const descriptionText = search
    ? `${result?.total ?? 0} résultat${(result?.total ?? 0) !== 1 ? "s" : ""}`
    : `${result?.total ?? 0} membre${(result?.total ?? 0) !== 1 ? "s" : ""}`

  return (
    <div className="space-y-4">
      <PageHeader
        title="Membres"
        description={descriptionText}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setEmailOpen(true)}>
              <EnvelopeSimpleIcon className="mr-1.5 size-4" />
              Envoyer un email
            </Button>
            {modules.sms && (
              <Button size="sm" variant="outline" onClick={() => setSmsOpen(true)}>
                <DeviceMobileIcon className="mr-1.5 size-4" />
                Envoyer un SMS
              </Button>
            )}
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="mr-1.5 size-4" />
              Ajouter
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {/* Search */}
        <div className="relative w-72">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Rechercher un membre…"
            value={searchInput}
            onChange={e => handleSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-9 pr-8 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                if (debounceRef.current) clearTimeout(debounceRef.current)
                setSearchInput("")
                setSearch("")
                setPage(1)
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>

        {/* Status filter */}
        <FilterSelect
          value={statusFilter}
          onChange={v => { setStatusFilter(v); setPage(1) }}
          options={[
            { value: "PENDING",  label: "En attente" },
            { value: "ACTIF",    label: "Actifs"     },
            { value: "INACTIF",  label: "Inactifs"   },
            { value: "SUSPENDU", label: "Suspendus"  },
          ]}
          placeholder="Tous les statuts"
        />

        {/* Type filter */}
        {types.length > 0 && (
          <FilterSelect
            value={typeFilter}
            onChange={v => { setTypeFilter(v); setPage(1) }}
            options={types.map(t => ({ value: t.id, label: t.name }))}
            placeholder="Tous les types"
          />
        )}
      </div>

      <DataTable
        columns={columns}
        data={membres}
        loading={isLoading}
        keyExtractor={(m) => m.id}
        empty={search ? `Aucun résultat pour « ${search} »` : "Aucun membre enregistré"}
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
        title="Ajouter un membre"
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
        title="Modifier le membre"
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
          } : undefined}
          onSubmit={handleUpdate}
          onCancel={() => setEditTarget(null)}
          loading={updateMutation.isPending}
          isSelf={editTarget?.userId === currentUser.id}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Supprimer ${deleteTarget?.firstName} ${deleteTarget?.lastName} ?`}
        description="Ce membre sera archivé et ne pourra plus accéder à l'association."
        confirmLabel="Supprimer"
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

      <Modal
        open={!!historyTarget}
        onOpenChange={(open) => !open && setHistoryTarget(null)}
        title={historyTarget ? `Historique — ${historyTarget.firstName} ${historyTarget.lastName}` : "Historique"}
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
