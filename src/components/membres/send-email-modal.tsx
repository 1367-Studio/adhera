"use client"

import { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  SendIcon, AlertTriangleIcon, UsersIcon, TagIcon, UserCheckIcon,
  SearchIcon, CheckIcon, PencilIcon, ChevronRightIcon, LoaderCircleIcon,
} from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { cn } from "@/lib/utils"

// ── Types ──────────────────────────────────────────────────────────────────────

type MembreTypeRef = { id: string; name: string; color: string }

type MembrePick = {
  id:        string
  firstName: string
  lastName:  string
  email:     string | null
  typeId:    string | null
  type:      MembreTypeRef | null
}

type RecipientMode = "all" | "type" | "manual"

// ── Email templates ────────────────────────────────────────────────────────────

const TEMPLATES: { id: string; label: string; description: string; subject: string; body: string }[] = [
  {
    id:          "blank",
    label:       "Message libre",
    description: "Partir d'un brouillon vide",
    subject:     "",
    body:        "",
  },
  {
    id:          "ag",
    label:       "Convocation AG",
    description: "Convoquer à l'assemblée générale",
    subject:     "Convocation à l'Assemblée Générale",
    body:        `<p>Chers membres,</p>
<p>Nous avons le plaisir de vous convoquer à notre <strong>Assemblée Générale</strong>.</p>
<p><strong>Date :</strong> [à compléter]<br>
<strong>Heure :</strong> [à compléter]<br>
<strong>Lieu :</strong> [à compléter]</p>
<p>À l'ordre du jour :</p>
<ul>
  <li>Rapport moral</li>
  <li>Rapport financier</li>
  <li>Élection du bureau</li>
  <li>Questions diverses</li>
</ul>
<p>Merci de confirmer votre présence.</p>
<p>Cordialement,<br>Le Bureau</p>`,
  },
  {
    id:          "cotisation",
    label:       "Rappel cotisation",
    description: "Relancer les membres pour le renouvellement",
    subject:     "Rappel — Renouvellement de votre cotisation",
    body:        `<p>Chers membres,</p>
<p>Nous vous rappelons que votre <strong>cotisation</strong> est à renouveler pour l'année en cours.</p>
<p>Vous pouvez procéder au règlement directement via votre espace membre, ou vous rapprocher du bureau.</p>
<p>Merci de régulariser votre situation dans les meilleurs délais.</p>
<p>Cordialement,<br>Le Bureau</p>`,
  },
  {
    id:          "event",
    label:       "Annonce événement",
    description: "Informer d'un prochain événement",
    subject:     "Annonce — [Titre de l'événement]",
    body:        `<p>Chers membres,</p>
<p>Nous sommes ravis de vous annoncer la prochaine tenue de :</p>
<p><strong>[Titre de l'événement]</strong><br>
<strong>Date :</strong> [à compléter]<br>
<strong>Lieu :</strong> [à compléter]</p>
<p>[Description de l'événement]</p>
<p>N'hésitez pas à vous inscrire via votre espace membre.</p>
<p>Cordialement,<br>Le Bureau</p>`,
  },
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  selected,
  onSelect,
}: {
  template: typeof TEMPLATES[0]
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-lg border p-3 transition-all text-sm",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:border-muted-foreground/40 hover:bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{template.label}</span>
        {selected && <CheckIcon className="size-3.5 text-primary shrink-0" />}
      </div>
      <p className="text-xs text-muted-foreground mt-0.5">{template.description}</p>
    </button>
  )
}

function MemberPickList({
  membres,
  selectedIds,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: {
  membres:       MembrePick[]
  selectedIds:   string[]
  onToggle:      (id: string) => void
  onSelectAll:   () => void
  onDeselectAll: () => void
}) {
  const [search, setSearch] = useState("")

  const filtered = search.trim()
    ? membres.filter(m =>
        `${m.lastName} ${m.firstName}`.toLowerCase().includes(search.toLowerCase()) ||
        (m.email ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : membres

  const allFilteredSelected = filtered.length > 0 && filtered.every(m => selectedIds.includes(m.id))

  function toggleFiltered() {
    if (allFilteredSelected) {
      filtered.forEach(m => { if (selectedIds.includes(m.id)) onToggle(m.id) })
    } else {
      filtered.forEach(m => { if (!selectedIds.includes(m.id)) onToggle(m.id) })
    }
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="p-2 border-b bg-muted/30 space-y-2">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Rechercher…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs text-muted-foreground">{filtered.length} membre{filtered.length > 1 ? "s" : ""}</span>
          <button
            type="button"
            onClick={toggleFiltered}
            className="text-xs text-primary hover:underline"
          >
            {allFilteredSelected ? "Désélectionner tout" : "Sélectionner tout"}
          </button>
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto divide-y">
        {filtered.length === 0 ? (
          <p className="text-center text-xs text-muted-foreground py-6">Aucun membre trouvé</p>
        ) : (
          filtered.map(m => {
            const isSelected = selectedIds.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onToggle(m.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors",
                  isSelected ? "bg-primary/5" : "hover:bg-muted/40",
                )}
              >
                <span className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
                  isSelected ? "bg-primary border-primary text-primary-foreground" : "border-input",
                )}>
                  {isSelected && <CheckIcon className="size-2.5" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="font-medium truncate block">{m.lastName} {m.firstName}</span>
                  {m.email && <span className="text-xs text-muted-foreground truncate block">{m.email}</span>}
                </span>
                {m.type && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0" style={{ background: `${m.type.color}20`, color: m.type.color }}>
                    {m.type.name}
                  </span>
                )}
              </button>
            )
          })
        )}
      </div>
      <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
        {selectedIds.length > 0
          ? `${selectedIds.length} membre${selectedIds.length > 1 ? "s" : ""} sélectionné${selectedIds.length > 1 ? "s" : ""}`
          : "Aucun membre sélectionné"}
      </div>
    </div>
  )
}

// ── Main modal ─────────────────────────────────────────────────────────────────

function hasHtmlContent(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").trim().length > 0
}

function hasContent(subject: string, body: string): boolean {
  return subject.trim().length > 0 || hasHtmlContent(body)
}

interface SendEmailModalProps {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export function SendEmailModal({ open, onOpenChange }: SendEmailModalProps) {
  const [step,              setStep]              = useState<"compose" | "confirm">("compose")
  const [recipientMode,     setRecipientMode]     = useState<RecipientMode>("all")
  const [selectedTypeId,    setSelectedTypeId]    = useState<string>("")
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [templateId,        setTemplateId]        = useState("blank")
  const [subject,           setSubject]           = useState("")
  const [bodyHtml,          setBodyHtml]          = useState("")
  const [sending,           setSending]           = useState(false)
  const [countLoading,      setCountLoading]      = useState(false)
  const [recipientCount,    setRecipientCount]    = useState<number | null>(null)
  const [selectedTypeName,  setSelectedTypeName]  = useState<string>("")

  // Reset when modal closes
  useEffect(() => {
    if (!open) {
      setStep("compose")
      setRecipientMode("all")
      setSelectedTypeId("")
      setSelectedMemberIds([])
      setTemplateId("blank")
      setSubject("")
      setBodyHtml("")
      setRecipientCount(null)
      setSelectedTypeName("")
      setCountLoading(false)
    }
  }, [open])

  // Types for filter
  const { data: types = [] } = useQuery<MembreTypeRef[]>({
    queryKey: ["membre-types"],
    queryFn:  () => fetch("/api/membre-types").then(r => r.json()),
    enabled:  open,
  })

  // Members for manual selection
  const { data: allMembres = [], isLoading: loadingMembres } = useQuery<MembrePick[]>({
    queryKey:  ["membres-email-pick"],
    queryFn:   () => fetch("/api/membres?status=ACTIF").then(r => r.json()),
    enabled:   open && recipientMode === "manual",
    staleTime: 30_000,
  })
  const membresWithEmail = allMembres.filter(m => m.email)

  function applyTemplate(id: string) {
    const tpl = TEMPLATES.find(t => t.id === id)
    if (!tpl) return

    // Warn before overwriting content the user already typed
    if (id !== templateId && hasContent(subject, bodyHtml)) {
      if (!confirm("Appliquer ce modèle remplacera le contenu actuel. Continuer ?")) return
    }

    setTemplateId(id)
    setSubject(tpl.subject)
    setBodyHtml(tpl.body)
  }

  function toggleMember(id: string) {
    setSelectedMemberIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function selectAllMembers() {
    setSelectedMemberIds(membresWithEmail.map(m => m.id))
  }

  function deselectAllMembers() {
    setSelectedMemberIds([])
  }

  async function handleContinue() {
    // Validate recipients
    if (recipientMode === "type" && !selectedTypeId) {
      toast.error("Sélectionnez un type de membre")
      return
    }
    if (recipientMode === "manual" && selectedMemberIds.length === 0) {
      toast.error("Sélectionnez au moins un membre")
      return
    }

    // Validate message
    if (!subject.trim()) {
      toast.error("Renseignez l'objet du message")
      return
    }
    if (!hasHtmlContent(bodyHtml)) {
      toast.error("Rédigez le contenu du message")
      return
    }

    // Compute recipient count for confirmation step
    if (recipientMode === "manual") {
      setRecipientCount(selectedMemberIds.length)
      setStep("confirm")
      return
    }

    setCountLoading(true)
    try {
      const qs  = recipientMode === "type" ? `?typeId=${selectedTypeId}` : ""
      const res = await fetch(`/api/membres/email/count${qs}`)
      const d   = await res.json()
      const count = d.count ?? 0

      if (count === 0) {
        toast.error("Aucun destinataire avec une adresse email dans cette sélection")
        return
      }

      setRecipientCount(count)
      setStep("confirm")
    } catch {
      toast.error("Impossible de vérifier le nombre de destinataires")
    } finally {
      setCountLoading(false)
    }
  }

  async function handleSend() {
    setSending(true)
    try {
      const body: Record<string, unknown> = { subject, bodyHtml }
      if (recipientMode === "manual")                 body.recipientIds = selectedMemberIds
      if (recipientMode === "type" && selectedTypeId) body.typeId = selectedTypeId

      const res  = await fetch("/api/membres/email", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Erreur"); return }
      toast.success(`Email envoyé à ${data.sent} membre${data.sent !== 1 ? "s" : ""}`)
      if (data.failed > 0) toast.warning(`${data.failed} envoi${data.failed !== 1 ? "s" : ""} échoué${data.failed !== 1 ? "s" : ""}`)
      onOpenChange(false)
    } catch {
      toast.error("Erreur réseau")
    } finally {
      setSending(false)
    }
  }

  function handleClose() {
    if (sending) return
    onOpenChange(false)
  }

  // Keep the type name in sync for the confirmation summary
  useEffect(() => {
    if (selectedTypeId) {
      const t = types.find(t => t.id === selectedTypeId)
      setSelectedTypeName(t?.name ?? "")
    } else {
      setSelectedTypeName("")
    }
  }, [selectedTypeId, types])

  const recipientSummary =
    recipientMode === "manual"
      ? `${selectedMemberIds.length} membre${selectedMemberIds.length > 1 ? "s" : ""} sélectionné${selectedMemberIds.length > 1 ? "s" : ""}`
      : recipientMode === "type" && selectedTypeName
        ? `${recipientCount} membre${(recipientCount ?? 0) > 1 ? "s" : ""} de type « ${selectedTypeName} »`
        : `${recipientCount} membre${(recipientCount ?? 0) > 1 ? "s" : ""} actif${(recipientCount ?? 0) > 1 ? "s" : ""}`

  return (
    <Modal
      open={open}
      onOpenChange={handleClose}
      title="Envoyer un email"
      size="lg"
      dismissable={!sending}
    >
      {step === "compose" ? (
        <div className="space-y-5">

          {/* ── Recipients ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Destinataires</p>
            <div className="grid grid-cols-3 gap-2">
              {([
                { mode: "all",    icon: UsersIcon,     label: "Tous les membres" },
                { mode: "type",   icon: TagIcon,       label: "Par type" },
                { mode: "manual", icon: UserCheckIcon, label: "Sélection manuelle" },
              ] as const).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setRecipientMode(mode)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-all",
                    recipientMode === mode
                      ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                      : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/40 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>

            {recipientMode === "all" && (
              <p className="text-xs text-muted-foreground">
                L'email sera envoyé à tous les <strong>membres actifs ayant une adresse email</strong>.
              </p>
            )}

            {recipientMode === "type" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Type de membre <span className="text-red-500">*</span></p>
                {types.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">Aucun type configuré</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {types.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTypeId(t.id === selectedTypeId ? "" : t.id)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all",
                          selectedTypeId === t.id
                            ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                            : "border-border text-muted-foreground hover:border-muted-foreground/40",
                        )}
                      >
                        <span className="size-2 rounded-full shrink-0" style={{ background: t.color }} />
                        {t.name}
                        {selectedTypeId === t.id && <CheckIcon className="size-3 ml-0.5" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {recipientMode === "manual" && (
              loadingMembres ? (
                <div className="h-40 rounded-lg bg-muted animate-pulse" />
              ) : membresWithEmail.length === 0 ? (
                <p className="text-sm text-muted-foreground italic text-center py-4">
                  Aucun membre actif avec une adresse email
                </p>
              ) : (
                <MemberPickList
                  membres={membresWithEmail}
                  selectedIds={selectedMemberIds}
                  onToggle={toggleMember}
                  onSelectAll={selectAllMembers}
                  onDeselectAll={deselectAllMembers}
                />
              )
            )}
          </div>

          <div className="border-t" />

          {/* ── Templates ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Modèle</p>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map(tpl => (
                <TemplateCard
                  key={tpl.id}
                  template={tpl}
                  selected={templateId === tpl.id}
                  onSelect={() => applyTemplate(tpl.id)}
                />
              ))}
            </div>
          </div>

          <div className="border-t" />

          {/* ── Message ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Message</p>
            <FormField
              label="Objet"
              required
              placeholder="Objet de l'email…"
              value={subject}
              onChange={e => setSubject(e.target.value)}
            />
            <RichTextEditor
              label="Corps du message"
              required
              value={bodyHtml}
              onChange={setBodyHtml}
              placeholder="Rédigez votre message…"
              minHeight="180px"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={handleClose}>Annuler</Button>
            <Button onClick={handleContinue} disabled={countLoading}>
              {countLoading
                ? <LoaderCircleIcon className="mr-1.5 size-4 animate-spin" />
                : <ChevronRightIcon className="mr-1.5 size-4" />
              }
              Continuer
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 flex gap-3">
            <AlertTriangleIcon className="size-5 shrink-0 text-amber-600 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Confirmation d'envoi</p>
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Cet email sera envoyé à <strong>{recipientSummary}</strong>. Cette action est irréversible.
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Objet</p>
              <p className="text-sm font-medium">{subject}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">Destinataires</p>
              <p className="text-sm font-medium">{recipientSummary}</p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStep("compose")} disabled={sending}>
              <PencilIcon className="mr-1.5 size-3.5" />
              Modifier
            </Button>
            <Button onClick={handleSend} loading={sending}>
              <SendIcon className="mr-1.5 size-4" />
              Envoyer maintenant
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
