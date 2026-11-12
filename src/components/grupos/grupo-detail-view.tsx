"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { dateOnlyToLocal } from "@/lib/date-format"
import {
  PlusIcon, XIcon, PencilSimpleIcon, ArchiveIcon, ArrowCounterClockwiseIcon, ChecksIcon,
} from "@phosphor-icons/react/dist/ssr"
import {
  useGrupo, useGrupoStaff, useUpdateGrupo, useArchiveGrupo,
  useAddGrupoMembro, useRemoveGrupoMembro, useAddGrupoResponsavel, useRemoveGrupoResponsavel,
} from "@/hooks/use-grupos"
import { useGrupoChamadas, useCreateChamada } from "@/hooks/use-chamadas"
import { useHasAccess } from "@/lib/user-context"
import { ApiError } from "@/lib/api-error"
import { DateField, todayValue } from "@/components/ui/date-field"
import { BackLink } from "@/components/ui/back-link"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { SelectField } from "@/components/ui/select-field"
import { FormField } from "@/components/ui/form-field"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command"
import { GrupoForm } from "@/components/grupos/grupo-form"
import { useQuery } from "@tanstack/react-query"
import type { GrupoInput } from "@/lib/schemas"
import type { ChamadaSessaoListItem } from "@/hooks/use-chamadas"

type MembreCandidate = { id: string; firstName: string; lastName: string; email: string }

export function GrupoDetailView({ grupoId }: { grupoId: string }) {
  const t       = useTranslations()
  const router  = useRouter()
  const canEdit = useHasAccess("groupes", "edit")

  const { data: grupo, isLoading } = useGrupo(grupoId)
  const { data: staff = [] }       = useGrupoStaff()
  const { data: chamadas = [], isLoading: chamadasLoading } = useGrupoChamadas(grupoId)

  const updateMutation  = useUpdateGrupo(grupoId)
  const archiveMutation = useArchiveGrupo(grupoId)
  const addMembroMutation = useAddGrupoMembro(grupoId)
  const removeMembroMutation = useRemoveGrupoMembro(grupoId)
  const addResponsavelMutation = useAddGrupoResponsavel(grupoId)
  const removeResponsavelMutation = useRemoveGrupoResponsavel(grupoId)
  const createChamadaMutation = useCreateChamada(grupoId)

  const [editOpen, setEditOpen]           = useState(false)
  const [archiveOpen, setArchiveOpen]     = useState(false)
  const [addMembroOpen, setAddMembroOpen] = useState(false)
  const [memberQuery, setMemberQuery]               = useState("")
  const [debouncedMemberQuery, setDebouncedMemberQuery] = useState("")
  const [removeMembroTarget, setRemoveMembroTarget] = useState<{ membreId: string; nome: string } | null>(null)
  const [addResponsavelId, setAddResponsavelId]      = useState("")
  const [removeResponsavelTarget, setRemoveResponsavelTarget] = useState<{ userId: string; nome: string } | null>(null)
  const [reopenChamadaId, setReopenChamadaId] = useState<string | null>(null)
  const [appelModalOpen, setAppelModalOpen] = useState(false)
  const [appelDate, setAppelDate]           = useState(todayValue())
  const [appelHorario, setAppelHorario]     = useState("")
  const [appelAtividade, setAppelAtividade] = useState("")

  // Évite un fetch à chaque frappe pendant la recherche de membre (voir add-manual-don-modal
  // pour le même motif).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedMemberQuery(memberQuery), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [memberQuery])

  const memberQueryReady = debouncedMemberQuery.trim().length >= 2
  const { data: candidates = [], isLoading: loadingCandidates } = useQuery<MembreCandidate[]>({
    queryKey: ["membres-search-for-grupo", debouncedMemberQuery],
    queryFn:  () => fetch(`/api/membres?status=ACTIF&search=${encodeURIComponent(debouncedMemberQuery.trim())}`).then(r => r.json()),
    enabled:  addMembroOpen && memberQueryReady,
  })

  if (isLoading || !grupo) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
  }

  async function handleUpdate(data: GrupoInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t("groupes.view.toasts.updated"))
      setEditOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleArchiveToggle() {
    const archiving = !grupo!.archivedAt
    try {
      await archiveMutation.mutateAsync(archiving)
      toast.success(archiving ? t("groupes.view.toasts.archived") : t("groupes.view.toasts.unarchived"))
      setArchiveOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleAddMembro(membre: MembreCandidate) {
    try {
      await addMembroMutation.mutateAsync({ membreId: membre.id })
      setAddMembroOpen(false)
      setMemberQuery("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleRemoveMembro() {
    if (!removeMembroTarget) return
    try {
      await removeMembroMutation.mutateAsync(removeMembroTarget.membreId)
      setRemoveMembroTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleAddResponsavel() {
    if (!addResponsavelId) return
    try {
      await addResponsavelMutation.mutateAsync({ userId: addResponsavelId })
      setAddResponsavelId("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleRemoveResponsavel() {
    if (!removeResponsavelTarget) return
    try {
      await removeResponsavelMutation.mutateAsync(removeResponsavelTarget.userId)
      setRemoveResponsavelTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  function openAppelModal() {
    setAppelDate(todayValue())
    setAppelHorario("")
    setAppelAtividade("")
    setAppelModalOpen(true)
  }

  async function handleFaireAppel() {
    try {
      const sessao = await createChamadaMutation.mutateAsync({ data: appelDate, horario: appelHorario, atividade: appelAtividade })
      setAppelModalOpen(false)
      router.push(`/dashboard/groupes/${grupoId}/appels/${sessao.id}`)
    } catch (err) {
      if (err instanceof ApiError && typeof err.details?.chamadaId === "string") {
        setAppelModalOpen(false)
        setReopenChamadaId(err.details.chamadaId)
      } else {
        toast.error(err instanceof Error ? err.message : t("common.error"))
      }
    }
  }

  const alreadyInGroup = new Set(grupo.membros.map(m => m.membreId))
  const staffNotYetResponsavel = staff.filter(s => !grupo.responsaveis.some(r => r.userId === s.id))

  const chamadaColumns: Column<ChamadaSessaoListItem>[] = [
    { key: "data", header: t("groupes.detail.appelColumns.date"), cell: (c) => `${format(dateOnlyToLocal(c.data), "dd/MM/yyyy")}${c.horario ? ` · ${c.horario}` : ""}` },
    { key: "presentes", header: t("groupes.detail.appelColumns.presents"), cell: (c) => c.counts.PRESENTE, className: "tabular-nums" },
    { key: "absentes", header: t("groupes.detail.appelColumns.absents"), cell: (c) => c.counts.AUSENTE, className: "tabular-nums" },
    { key: "justificadas", header: t("groupes.detail.appelColumns.justifies"), cell: (c) => c.counts.AUSENCIA_JUSTIFICADA, className: "tabular-nums" },
    { key: "naoInformado", header: t("groupes.detail.appelColumns.nonRenseignes"), cell: (c) => c.counts.NAO_INFORMADO, className: "tabular-nums text-muted-foreground" },
  ]

  return (
    <div className="space-y-6">
      <BackLink href="/dashboard/groupes">{t("groupes.detail.backToList")}</BackLink>

      <PageHeader
        title={grupo.nome}
        description={grupo.descricao || (grupo.archivedAt && <Badge variant="outline">{t("groupes.view.statusBadge.archive")}</Badge>)}
        action={canEdit && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>
              <PencilSimpleIcon className="mr-1.5 size-4" />
              {t("groupes.view.actions.edit")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setArchiveOpen(true)}>
              {grupo.archivedAt ? <ArrowCounterClockwiseIcon className="mr-1.5 size-4" /> : <ArchiveIcon className="mr-1.5 size-4" />}
              {t(grupo.archivedAt ? "groupes.view.actions.unarchive" : "groupes.view.actions.archive")}
            </Button>
          </div>
        )}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("groupes.detail.membresTitle")} ({grupo.membros.length})</h3>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={() => setAddMembroOpen(true)}>
              <PlusIcon className="mr-1.5 size-4" />
              {t("groupes.detail.addMembre")}
            </Button>
          )}
        </div>
        {grupo.membros.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("groupes.detail.noMembre")}</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {grupo.membros.map(m => (
              <div key={m.membreId} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm">{m.membre.firstName} {m.membre.lastName}</span>
                {canEdit && (
                  <Button
                    size="icon-sm" variant="ghost"
                    aria-label={t("groupes.detail.removeMembreConfirmTitle", { name: `${m.membre.firstName} ${m.membre.lastName}` })}
                    onClick={() => setRemoveMembroTarget({ membreId: m.membreId, nome: `${m.membre.firstName} ${m.membre.lastName}` })}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t("groupes.detail.responsaveisTitle")} ({grupo.responsaveis.length})</h3>
        {grupo.responsaveis.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("groupes.detail.noResponsavel")}</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {grupo.responsaveis.map(r => (
              <div key={r.userId} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm">{r.user.name ?? r.user.email}</span>
                {canEdit && (
                  <Button
                    size="icon-sm" variant="ghost"
                    aria-label={t("groupes.detail.removeResponsavelConfirmTitle", { name: r.user.name ?? r.user.email })}
                    onClick={() => setRemoveResponsavelTarget({ userId: r.userId, nome: r.user.name ?? r.user.email })}
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {canEdit && staffNotYetResponsavel.length > 0 && (
          <div className="flex items-end gap-2">
            <div className="w-64">
              <SelectField
                label={t("groupes.detail.addResponsavel")}
                value={addResponsavelId}
                onValueChange={setAddResponsavelId}
                options={staffNotYetResponsavel.map(s => ({ value: s.id, label: s.name ?? s.email }))}
              />
            </div>
            <Button size="sm" variant="secondary" disabled={!addResponsavelId} loading={addResponsavelMutation.isPending} onClick={handleAddResponsavel}>
              {t("common.add")}
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("groupes.detail.appelsTitle")}</h3>
          <Button size="sm" onClick={openAppelModal} disabled={!!grupo.archivedAt || grupo.membros.length === 0}>
            <ChecksIcon className="mr-1.5 size-4" />
            {t("groupes.detail.faireAppel")}
          </Button>
        </div>
        {grupo.membros.length === 0 && !grupo.archivedAt && (
          <p className="text-sm text-muted-foreground">{t("groupes.detail.noMembreForAppel")}</p>
        )}
        <DataTable
          columns={chamadaColumns}
          data={chamadas}
          loading={chamadasLoading}
          keyExtractor={(c) => c.id}
          empty={t("groupes.detail.noAppel")}
          onRowClick={(c) => router.push(`/dashboard/groupes/${grupoId}/appels/${c.id}`)}
        />
      </section>

      <Modal open={editOpen} onOpenChange={setEditOpen} title={t("groupes.view.editTitle")} dismissable={false}>
        <GrupoForm
          defaultValues={{ nome: grupo.nome, descricao: grupo.descricao ?? "" }}
          onSubmit={handleUpdate}
          onCancel={() => setEditOpen(false)}
          loading={updateMutation.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={t(grupo.archivedAt ? "groupes.view.unarchiveConfirmTitle" : "groupes.view.archiveConfirmTitle", { name: grupo.nome })}
        description={grupo.archivedAt ? undefined : t("groupes.view.archiveConfirmDescription")}
        confirmLabel={t(grupo.archivedAt ? "groupes.view.actions.unarchive" : "groupes.view.actions.archive")}
        confirmVariant={grupo.archivedAt ? "default" : "destructive"}
        loading={archiveMutation.isPending}
        onConfirm={handleArchiveToggle}
      />

      <ConfirmDialog
        open={!!removeMembroTarget}
        onOpenChange={(open) => !open && setRemoveMembroTarget(null)}
        title={t("groupes.detail.removeMembreConfirmTitle", { name: removeMembroTarget?.nome ?? "" })}
        description={t("groupes.detail.removeMembreConfirmDescription")}
        confirmLabel={t("common.delete")}
        loading={removeMembroMutation.isPending}
        onConfirm={handleRemoveMembro}
      />

      <ConfirmDialog
        open={!!removeResponsavelTarget}
        onOpenChange={(open) => !open && setRemoveResponsavelTarget(null)}
        title={t("groupes.detail.removeResponsavelConfirmTitle", { name: removeResponsavelTarget?.nome ?? "" })}
        confirmLabel={t("common.delete")}
        loading={removeResponsavelMutation.isPending}
        onConfirm={handleRemoveResponsavel}
      />

      <ConfirmDialog
        open={!!reopenChamadaId}
        onOpenChange={(open) => !open && setReopenChamadaId(null)}
        title={t("groupes.detail.reopenExistingTitle")}
        description={t("groupes.detail.reopenExistingDescription")}
        confirmLabel={t("groupes.detail.reopenExistingConfirm")}
        confirmVariant="default"
        onConfirm={() => { if (reopenChamadaId) router.push(`/dashboard/groupes/${grupoId}/appels/${reopenChamadaId}`) }}
      />

      <Modal open={appelModalOpen} onOpenChange={setAppelModalOpen} title={t("groupes.detail.faireAppel")} dismissable={false}>
        <div className="space-y-4">
          <DateField
            label={t("groupes.detail.newAppelDateLabel")}
            value={appelDate}
            onChange={setAppelDate}
            required
            clearable={false}
          />
          <FormField
            label={t("groupes.appel.horarioLabel")}
            placeholder={t("groupes.appel.horarioPlaceholder")}
            value={appelHorario}
            onChange={e => setAppelHorario(e.target.value)}
          />
          <FormField
            label={t("groupes.appel.activityLabel")}
            placeholder={t("groupes.appel.activityPlaceholder")}
            value={appelAtividade}
            onChange={e => setAppelAtividade(e.target.value)}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setAppelModalOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleFaireAppel} loading={createChamadaMutation.isPending} disabled={!appelDate}>
              {t("groupes.detail.newAppelSubmit")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={addMembroOpen} onOpenChange={(open) => { setAddMembroOpen(open); if (!open) setMemberQuery("") }} title={t("groupes.detail.addMembre")}>
        <Command className="rounded-lg! border" shouldFilter={false}>
          <CommandInput value={memberQuery} onValueChange={setMemberQuery} placeholder={t("groupes.view.searchPlaceholder")} />
          <CommandList>
            {!memberQueryReady ? (
              <CommandEmpty>{t("common.search")}…</CommandEmpty>
            ) : loadingCandidates ? (
              <div className="p-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-8 rounded-md bg-muted animate-pulse" />)}
              </div>
            ) : (
              <>
                <CommandEmpty>{t("groupes.view.noResultsFor", { search: memberQuery })}</CommandEmpty>
                {candidates.filter(c => !alreadyInGroup.has(c.id)).map(candidate => (
                  <CommandItem key={candidate.id} value={`${candidate.lastName} ${candidate.firstName}`} onSelect={() => handleAddMembro(candidate)}>
                    <span className="truncate">{candidate.firstName} {candidate.lastName}</span>
                    <span className="ml-2 truncate text-xs text-muted-foreground">{candidate.email}</span>
                  </CommandItem>
                ))}
              </>
            )}
          </CommandList>
        </Command>
      </Modal>
    </div>
  )
}
