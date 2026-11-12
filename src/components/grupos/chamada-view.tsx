"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { CheckCircleIcon, DownloadSimpleIcon, UserPlusIcon } from "@phosphor-icons/react/dist/ssr"
import { useChamada, useSaveChamada, useSyncChamadaMembres } from "@/hooks/use-chamadas"
import { useBranding, useCanUseCustomBranding } from "@/lib/user-context"
import { loadLogoForPdf } from "@/lib/pdf/branded-header-client"
import { dateOnlyToLocal } from "@/lib/date-format"
import { BASE_PATH } from "@/lib/env"
import { APP_NAME } from "@/config/brand"
import { CHAMADA_PRESENCA_STATUSES, type ChamadaPresencaStatusValue } from "@/lib/schemas"
import { BackLink } from "@/components/ui/back-link"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { DateField, toValue } from "@/components/ui/date-field"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

type EntryMap = Record<string, ChamadaPresencaStatusValue>

export function ChamadaView({ grupoId, chamadaId }: { grupoId: string; chamadaId: string }) {
  const t      = useTranslations()
  const branding   = useBranding()
  const canBrand   = useCanUseCustomBranding()

  const { data: chamada, isLoading } = useChamada(grupoId, chamadaId)
  const saveMutation = useSaveChamada(grupoId, chamadaId)
  const syncMutation = useSyncChamadaMembres(grupoId, chamadaId)

  const [date, setDate]           = useState("")
  const [horario, setHorario]     = useState("")
  const [atividade, setAtividade] = useState("")
  const [entries, setEntries]     = useState<EntryMap>({})

  useEffect(() => {
    if (!chamada) return
    setDate(toValue(dateOnlyToLocal(chamada.data)))
    setHorario(chamada.horario ?? "")
    setAtividade(chamada.atividade ?? "")
    setEntries(Object.fromEntries(chamada.presencas.map(p => [p.membreId, p.status])))
  }, [chamada])

  const counts = useMemo(() => {
    const base: Record<ChamadaPresencaStatusValue, number> = { NAO_INFORMADO: 0, PRESENTE: 0, AUSENTE: 0, AUSENCIA_JUSTIFICADA: 0 }
    for (const status of Object.values(entries)) base[status]++
    return base
  }, [entries])

  if (isLoading || !chamada) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("common.loading")}</p>
  }
  // Narrowed alias: closures below (handleExportPdf/handleExportXlsx) capture `chamada` by
  // reference, and TS doesn't carry the early-return narrowing into a nested function scope.
  const detail = chamada

  const statusOptions = CHAMADA_PRESENCA_STATUSES.map(value => ({ value, label: t(`groupes.appel.status.${value}`) }))

  // Ne remplit que les présences encore "non renseigné" — ne doit jamais écraser une absence
  // ou une justification déjà saisie par accident (édge case trouvé en revue).
  function markAllPresent() {
    setEntries(prev => Object.fromEntries(
      Object.entries(prev).map(([membreId, status]) => [membreId, status === "NAO_INFORMADO" ? "PRESENTE" as const : status]),
    ))
  }

  async function handleSave() {
    try {
      await saveMutation.mutateAsync({
        data: date,
        horario,
        atividade,
        entries: Object.entries(entries).map(([membreId, status]) => ({ membreId, status })),
        // Concurrence optimiste : si quelqu'un d'autre a sauvegardé entre-temps, le serveur
        // refuse (409) au lieu de laisser cet état local périmé écraser son travail.
        expectedUpdatedAt: detail.updatedAt,
      })
      toast.success(t("groupes.appel.toasts.saved"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  // Un membre ajouté au groupe après la création de cet appel n'a pas de ligne de présence —
  // ce bouton rattrape ceux qui manquent (voir /sync route), sans jamais toucher aux entrées
  // déjà là.
  async function handleSyncMembres() {
    try {
      const result = await syncMutation.mutateAsync()
      toast.success(t("groupes.appel.toasts.synced", { count: result.addedCount }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleExportXlsx(blank: boolean) {
    if (detail.presencas.length === 0) { toast.error(t("groupes.appel.toasts.noMembersToExport")); return }
    window.location.href = `${BASE_PATH}/api/grupos/${grupoId}/chamadas/${chamadaId}/export${blank ? "?blank=1" : ""}`
  }

  async function handleExportPdf(blank: boolean) {
    if (detail.presencas.length === 0) { toast.error(t("groupes.appel.toasts.noMembersToExport")); return }

    const { default: jsPDF }     = await import("jspdf")
    const { default: autoTable } = await import("jspdf-autotable")

    const doc   = new jsPDF({ unit: "mm", format: "a4" })
    const W     = 210
    const M     = 14
    const ZINC  = [113, 113, 122] as [number, number, number]
    const BLACK = [24, 24, 27] as [number, number, number]
    const today = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })

    const logo = canBrand && branding?.logoUrl ? await loadLogoForPdf("/api/association/branding/logo") : null

    const headerH = 30
    doc.setFillColor(0, 0, 0)
    doc.rect(0, 0, W, headerH, "F")
    doc.setTextColor(255, 255, 255)
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    const rightLabelW = doc.getTextWidth("Liste de présence")
    doc.setFontSize(10)
    doc.setFont("helvetica", "bold")
    if (logo) {
      const logoH = 20
      const logoW = logo.width * (logoH / logo.height)
      doc.addImage(logo.dataUrl, logo.format, M, (headerH - logoH) / 2, logoW, logoH)
    } else {
      const availW = (W - M) - M - rightLabelW - 6
      const fullName = (canBrand ? (branding?.name ?? APP_NAME) : APP_NAME).toUpperCase()
      let name = fullName
      while (name.length > 1 && doc.getTextWidth(`${name}…`) > availW) name = name.slice(0, -1)
      doc.text(name.length < fullName.length ? `${name}…` : name, M, headerH / 2 + 3)
    }
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text("Liste de présence", W - M, headerH / 2 + 3, { align: "right" })

    let y = headerH + 12
    doc.setTextColor(...BLACK)
    doc.setFontSize(16)
    doc.setFont("helvetica", "bold")
    doc.text(detail.grupoNome, M, y)
    y += 7

    doc.setFontSize(8.5)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...ZINC)
    const dateStr = format(dateOnlyToLocal(detail.data), "EEEE dd MMMM yyyy", { locale: fr }) + (detail.horario ? ` · ${detail.horario}` : "")
    doc.text(dateStr, M, y)
    doc.text(`Généré le ${today}`, W - M, y, { align: "right" })
    y += 10

    doc.setDrawColor(228, 228, 231)
    doc.line(M, y, W - M, y)
    y += 5

    const sorted = [...detail.presencas].sort((a, b) => a.membre.lastName.localeCompare(b.membre.lastName, "fr"))

    autoTable(doc, {
      margin:             { left: M, right: M },
      startY:             y,
      head:               [["#", "Nom", "Prénom", "Statut"]],
      body:               sorted.map((p, i) => [i + 1, p.membre.lastName, p.membre.firstName, blank ? "" : t(`groupes.appel.status.${entries[p.membreId] ?? p.status}`)]),
      headStyles:         { fillColor: [0, 0, 0] as [number, number, number], textColor: [255, 255, 255] as [number, number, number], fontStyle: "bold" as const, fontSize: 8 },
      bodyStyles:         { fontSize: 8.5, textColor: BLACK },
      alternateRowStyles: { fillColor: [250, 250, 250] as [number, number, number] },
      styles:             { cellPadding: 3, lineColor: [228, 228, 231] as [number, number, number], lineWidth: 0.1 },
    })

    doc.save(`appel_${format(dateOnlyToLocal(detail.data), "yyyy-MM-dd")}_${detail.grupoNome.replace(/[^a-z0-9]/gi, "_").toLowerCase()}${blank ? "_vierge" : ""}.pdf`)
  }

  const sortedPresencas = [...chamada.presencas].sort((a, b) => a.membre.lastName.localeCompare(b.membre.lastName, "fr"))

  return (
    <div className="space-y-6">
      <BackLink href={`/dashboard/groupes/${grupoId}`}>{t("groupes.appel.backToGroupe")}</BackLink>

      <PageHeader
        title={chamada.grupoNome}
        description={`${counts.PRESENTE} ${t("groupes.appel.counts.presente").toLowerCase()} · ${counts.AUSENTE} ${t("groupes.appel.counts.ausente").toLowerCase()} · ${counts.AUSENCIA_JUSTIFICADA} ${t("groupes.appel.counts.ausenciaJustificada").toLowerCase()} · ${counts.NAO_INFORMADO} ${t("groupes.appel.counts.naoInformado").toLowerCase()}`}
        action={
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="secondary" />}>
                <DownloadSimpleIcon className="mr-1.5 size-4" />
                {t("groupes.appel.export")}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExportPdf(false)}>{t("groupes.appel.exportPdf")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportPdf(true)}>{t("groupes.appel.exportPdfBlank")}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExportXlsx(false)}>{t("groupes.appel.exportExcel")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="sm" onClick={handleSave} loading={saveMutation.isPending}>
              <CheckCircleIcon className="mr-1.5 size-4" />
              {t("groupes.appel.save")}
            </Button>
          </div>
        }
      />

      <div className="grid max-w-xl grid-cols-3 gap-3">
        <DateField label={t("groupes.appel.dateLabel")} value={date} onChange={setDate} required clearable={false} />
        <FormField
          label={t("groupes.appel.horarioLabel")}
          placeholder={t("groupes.appel.horarioPlaceholder")}
          value={horario}
          onChange={e => setHorario(e.target.value)}
        />
        <FormField
          label={t("groupes.appel.activityLabel")}
          placeholder={t("groupes.appel.activityPlaceholder")}
          value={atividade}
          onChange={e => setAtividade(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={handleSyncMembres} loading={syncMutation.isPending}>
          <UserPlusIcon className="mr-1.5 size-4" />
          {t("groupes.appel.syncMembres")}
        </Button>
        <Button size="sm" variant="ghost" onClick={markAllPresent}>{t("groupes.appel.markAllPresent")}</Button>
      </div>

      <div className="divide-y rounded-lg border">
        {sortedPresencas.map(p => (
          <div key={p.membreId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
            <span className="text-sm font-medium">{p.membre.firstName} {p.membre.lastName}</span>
            <SegmentedControl
              size="sm"
              options={statusOptions}
              value={entries[p.membreId] ?? "NAO_INFORMADO"}
              onChange={(value) => setEntries(prev => ({ ...prev, [p.membreId]: value }))}
              ariaLabel={`${p.membre.firstName} ${p.membre.lastName}`}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
