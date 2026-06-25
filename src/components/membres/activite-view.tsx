"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { FilterXIcon, ChevronLeftIcon, ChevronRightIcon, AlertCircleIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"

// ─── Types ──────────────────────────────────────────────────────────────────

type FieldDiff = { old: string | null; new: string | null }

type LogEntry = {
  id:        string
  action:    string
  actorName: string | null
  actorId:   string | null
  entity:    string
  entityId:  string | null
  label:     string | null
  metadata: {
    changes?:    Record<string, FieldDiff>
    status?:     string
    oldStatus?:  string
    type?:       string
    amount?:     number | null
    rsvp?:       string
    present?:    boolean
    memberName?: string
    quantity?:   number
  } | null
  createdAt: string
}

type LogsResponse = {
  data:       LogEntry[]
  total:      number
  page:       number
  totalPages: number
}

// ─── Config ─────────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  firstName: "Prénom", lastName: "Nom", email: "Email",
  phone: "Téléphone", address: "Adresse", birthDate: "Date de naissance",
  status: "Statut", typeId: "Type",
}

const STATUS_LABELS: Record<string, string> = {
  ACTIF: "Actif", INACTIF: "Inactif", PENDING: "En attente", SUSPENDU: "Suspendu",
  EN_ATTENTE: "En attente", PAYE: "Payé", EXONERE: "Exonéré",
  ACTIVE: "Actif", PAUSED: "Pausé", DONE: "Terminé",
}

const RSVP_LABELS: Record<string, string> = {
  CONFIRME: "Confirmé", PROVAVEL: "Probable", INCERTO: "Incertain", ABSENT: "Absent",
}

const ACTUALITE_FIELD_LABELS: Record<string, string> = {
  title:         "Titre",
  pinned:        "Épinglé",
  publishedAt:   "Publication",
  recipientMode: "Destinataires",
  content:       "Contenu",
}

const RECIPIENT_MODE_LABELS: Record<string, string> = {
  ALL: "Tous les membres", SELECTED: "Sélection",
}

function formatActualiteValue(field: string, value: string | null): string {
  if (value === null) {
    if (field === "pinned")      return "Non"
    if (field === "publishedAt") return "Brouillon"
    return "—"
  }
  if (field === "pinned")        return value === "true" ? "Oui" : "Non"
  if (field === "publishedAt")   return format(new Date(value), "d MMM yyyy", { locale: fr })
  if (field === "recipientMode") return RECIPIENT_MODE_LABELS[value] ?? value
  return value
}

const DEL  = "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
const BLUE = "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
const BLUE_L = "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400"
const AMB  = "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
const AMB_L = "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400"
const VIO  = "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
const VIO_L = "bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400"
const TEAL = "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
const EME  = "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
const EME_L = "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400"
const ORA  = "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
const ORA_L = "bg-orange-50 text-orange-600 dark:bg-orange-900/20 dark:text-orange-400"
const PUR  = "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
const PUR_L = "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400"
const IND  = "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
const IND_L = "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400"
const SLA  = "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
const SLA_L = "bg-slate-50 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400"
const ROSE = "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
const SKY  = "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
const CYA  = "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300"
const CYA_L = "bg-cyan-50 text-cyan-600 dark:bg-cyan-900/20 dark:text-cyan-400"
const YEL  = "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"

const ACTION_CONFIG: Record<string, { label: string; color: string }> = {
  // Membres (blue)
  MEMBRE_CREATED:           { label: "Membre ajouté",       color: BLUE   },
  MEMBRE_UPDATED:           { label: "Membre modifié",      color: BLUE_L },
  MEMBRE_DELETED:           { label: "Membre archivé",      color: DEL    },
  MEMBRE_PORTAL_REGISTERED: { label: "Inscrit (portail)",   color: SKY    },
  PROFIL_UPDATED:           { label: "Profil modifié",      color: BLUE_L },
  // Actualités (amber)
  ACTUALITE_CREATED:        { label: "Actualité créée",     color: AMB    },
  ACTUALITE_UPDATED:        { label: "Actualité modifiée",  color: AMB_L  },
  ACTUALITE_DELETED:        { label: "Actualité supprimée", color: DEL    },
  // Événements (violet)
  EVENEMENT_CREATED:        { label: "Événement créé",      color: VIO    },
  EVENEMENT_UPDATED:        { label: "Événement modifié",   color: VIO_L  },
  EVENEMENT_DELETED:        { label: "Événement supprimé",  color: DEL    },
  PRESENCE_MARKED:          { label: "Présence marquée",    color: TEAL   },
  RSVP_UPDATED:             { label: "RSVP mis à jour",     color: VIO    },
  // Cotisations (emerald)
  COTISATION_CREATED:       { label: "Cotisation créée",    color: EME    },
  COTISATION_UPDATED:       { label: "Cotisation modifiée", color: EME_L  },
  COTISATION_DELETED:       { label: "Cotisation supprimée",color: DEL    },
  // Trésorerie (cyan)
  TRESORERIE_CREATED:       { label: "Entrée ajoutée",      color: CYA    },
  TRESORERIE_UPDATED:       { label: "Entrée modifiée",     color: CYA_L  },
  TRESORERIE_DELETED:       { label: "Entrée supprimée",    color: DEL    },
  // Matériel (orange)
  MATERIEL_CREATED:         { label: "Matériel ajouté",     color: ORA    },
  MATERIEL_UPDATED:         { label: "Matériel modifié",    color: ORA_L  },
  MATERIEL_DELETED:         { label: "Matériel supprimé",   color: DEL    },
  // Prêts (orange / status-based)
  LOAN_CREATED:             { label: "Prêt créé",           color: ORA    },
  LOAN_REQUESTED:           { label: "Prêt demandé",        color: YEL    },
  LOAN_CONFIRMED:           { label: "Prêt confirmé",       color: EME    },
  LOAN_REFUSED:             { label: "Prêt refusé",         color: DEL    },
  LOAN_RETURNED:            { label: "Prêt rendu",          color: TEAL   },
  LOAN_UPDATED:             { label: "Demande modifiée",    color: ORA_L  },
  LOAN_CANCELLED:           { label: "Demande annulée",     color: DEL    },
  LOAN_DELETED:             { label: "Prêt supprimé",       color: DEL    },
  // Modèles (purple)
  TEMPLATE_CREATED:         { label: "Modèle créé",         color: PUR    },
  TEMPLATE_UPDATED:         { label: "Modèle modifié",      color: PUR_L  },
  TEMPLATE_DELETED:         { label: "Modèle supprimé",     color: DEL    },
  // Automatisations (indigo)
  RULE_CREATED:             { label: "Règle créée",         color: IND    },
  RULE_UPDATED:             { label: "Règle modifiée",      color: IND_L  },
  RULE_DELETED:             { label: "Règle supprimée",     color: DEL    },
  // Types membres (slate)
  TYPE_CREATED:             { label: "Type créé",           color: SLA    },
  TYPE_UPDATED:             { label: "Type modifié",        color: SLA_L  },
  TYPE_DELETED:             { label: "Type supprimé",       color: DEL    },
  // Association / Site (rose)
  ASSOCIATION_UPDATED:      { label: "Paramètres modifiés",  color: ROSE   },
  SITE_UPDATED:             { label: "Site web modifié",     color: ROSE   },
  SITE_PUBLISHED:           { label: "Site web publié",      color: EME    },
  SITE_UNPUBLISHED:         { label: "Site web dépublié",    color: SLA    },
}

const ENTITY_LABELS: Record<string, string> = {
  Membre:          "Membres",
  Actualite:       "Actualités",
  Evenement:       "Événements",
  Participation:   "Présences / RSVP",
  Cotisation:      "Cotisations",
  Tresorerie:      "Trésorerie",
  Material:        "Matériel",
  MaterialLoan:    "Prêts",
  MessageTemplate: "Modèles",
  AutomationRule:  "Automatisations",
  MembreType:      "Types membres",
  Association:     "Paramètres",
}

const ENTITY_OPTIONS = [
  { value: "Membre",          label: "Membres"          },
  { value: "Actualite",       label: "Actualités"       },
  { value: "Evenement",       label: "Événements"       },
  { value: "Participation",   label: "Présences / RSVP" },
  { value: "Cotisation",      label: "Cotisations"      },
  { value: "Tresorerie",      label: "Trésorerie"       },
  { value: "Material",        label: "Matériel"         },
  { value: "MaterialLoan",    label: "Prêts"            },
  { value: "MessageTemplate", label: "Modèles msg"      },
  { value: "AutomationRule",  label: "Automatisations"  },
  { value: "MembreType",      label: "Types membres"    },
  { value: "Association",     label: "Paramètres"       },
]

// ─── Sub-components ──────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_CONFIG[action] ?? { label: action, color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" }
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap", cfg.color)}>
      {cfg.label}
    </span>
  )
}

function Details({ log }: { log: LogEntry }) {
  const m = log.metadata
  if (!m) return <span className="text-muted-foreground text-xs">—</span>

  if (log.action === "ACTUALITE_UPDATED" && m.changes) {
    const entries = Object.entries(m.changes)
    if (entries.length === 0) return <span className="text-muted-foreground text-xs">—</span>
    return (
      <div className="space-y-0.5">
        {entries.map(([field, diff]) => (
          <p key={field} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{ACTUALITE_FIELD_LABELS[field] ?? field}</span>
            {" "}
            {field === "content" ? (
              <span className="italic">modifié</span>
            ) : (
              <>
                <span className="line-through opacity-50">{formatActualiteValue(field, diff.old)}</span>
                {" → "}
                <span>{formatActualiteValue(field, diff.new)}</span>
              </>
            )}
          </p>
        ))}
      </div>
    )
  }

  if ((log.action === "MEMBRE_UPDATED" || log.action === "PROFIL_UPDATED") && m.changes) {
    const entries = Object.entries(m.changes)
    if (entries.length === 0) return <span className="text-muted-foreground text-xs">—</span>
    return (
      <div className="space-y-0.5">
        {entries.map(([field, diff]) => (
          <p key={field} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{FIELD_LABELS[field] ?? field}</span>
            {" "}
            <span className="line-through opacity-50">{diff.old ? (field === "status" ? STATUS_LABELS[diff.old] ?? diff.old : diff.old) : "—"}</span>
            {" → "}
            <span>{diff.new ? (field === "status" ? STATUS_LABELS[diff.new] ?? diff.new : diff.new) : "—"}</span>
          </p>
        ))}
      </div>
    )
  }

  if (m.status) {
    return (
      <p className="text-xs text-muted-foreground">
        {m.oldStatus && <><span className="line-through opacity-50">{STATUS_LABELS[m.oldStatus] ?? m.oldStatus}</span>{" → "}</>}
        <span>{STATUS_LABELS[m.status] ?? m.status}</span>
      </p>
    )
  }

  if (m.type && m.amount != null) {
    return <p className="text-xs text-muted-foreground">{m.type === "ENTREE" ? "+" : "-"}{m.amount.toFixed(2)} €</p>
  }

  if (m.rsvp) {
    return <p className="text-xs text-muted-foreground">RSVP : <span className="font-medium">{RSVP_LABELS[m.rsvp] ?? m.rsvp}</span></p>
  }

  if (m.present !== undefined) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className={m.present ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
          {m.present ? "Présent" : "Absent"}
        </span>
        {m.memberName ? ` — ${m.memberName}` : ""}
      </p>
    )
  }

  if (m.quantity !== undefined) {
    return <p className="text-xs text-muted-foreground">Qté : {m.quantity}</p>
  }

  return <span className="text-muted-foreground text-xs">—</span>
}

function FilterSelect({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; placeholder: string
}) {
  const selected = options.find(o => o.value === value)
  return (
    <Select value={value || "__all__"} onValueChange={v => onChange(v === "__all__" ? "" : (v ?? ""))}>
      <SelectTrigger className="w-44 h-9">
        <span className={cn("text-sm truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{placeholder}</SelectItem>
        {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export function ActiviteView() {
  const [page,   setPage]   = useState(1)
  const [entity, setEntity] = useState("")
  const [from,   setFrom]   = useState("")
  const [to,     setTo]     = useState("")

  const hasFilters = !!(entity || from || to)

  function buildParams() {
    const p = new URLSearchParams({ page: String(page) })
    if (entity) p.append("entity", entity)
    if (from)   p.append("from",   from)
    if (to)     p.append("to",     to)
    return p.toString()
  }

  const { data, isLoading, isError, refetch } = useQuery<LogsResponse>({
    queryKey: ["activity-logs", page, entity, from, to],
    queryFn:  async () => {
      const res = await fetch(`/api/activity-logs?${buildParams()}`)
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  const logs       = data?.data ?? []
  const total      = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  function resetFilters() { setEntity(""); setFrom(""); setTo(""); setPage(1) }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activité"
        description={isLoading ? "…" : isError ? "—" : `${total} action${total !== 1 ? "s" : ""}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect value={entity} onChange={v => { setEntity(v); setPage(1) }} options={ENTITY_OPTIONS} placeholder="Tous les modules" />

        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground">Du</label>
          <input type="date" value={from} max={to || undefined}
            onChange={e => { setFrom(e.target.value); setPage(1) }}
            className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring w-36"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground">au</label>
          <input type="date" value={to} min={from || undefined}
            onChange={e => { setTo(e.target.value); setPage(1) }}
            className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring w-36"
          />
        </div>

        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={resetFilters} className="h-9 gap-1.5 text-muted-foreground">
            <FilterXIcon className="size-3.5" />
            Réinitialiser
          </Button>
        )}
      </div>

      {isError && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircleIcon className="size-4 shrink-0" />
            Erreur lors du chargement des activités.
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()} className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/10">
            Réessayer
          </Button>
        </div>
      )}

      {!isError && <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-36">Date</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-36">Action</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Élément</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-32 hidden md:table-cell">Par</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground hidden lg:table-cell">Détails</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="border-b">
                <td className="px-4 py-3"><div className="h-4 w-28 rounded bg-muted animate-pulse" /></td>
                <td className="px-4 py-3"><div className="h-5 w-24 rounded-full bg-muted animate-pulse" /></td>
                <td className="px-4 py-3"><div className="h-4 w-40 rounded bg-muted animate-pulse" /></td>
                <td className="px-4 py-3 hidden md:table-cell"><div className="h-4 w-24 rounded bg-muted animate-pulse" /></td>
                <td className="px-4 py-3 hidden lg:table-cell"><div className="h-4 w-32 rounded bg-muted animate-pulse" /></td>
              </tr>
            ))}

            {!isLoading && !isError && logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground text-sm">
                  Aucune activité trouvée
                </td>
              </tr>
            )}

            {!isLoading && logs.map(log => (
              <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(log.createdAt), "d MMM yyyy, HH:mm", { locale: fr })}
                </td>
                <td className="px-4 py-3">
                  <ActionBadge action={log.action} />
                </td>
                <td className="px-4 py-3 max-w-[200px]">
                  <p className="font-medium truncate">
                    {log.label ?? <span className="text-muted-foreground italic text-xs">Élément supprimé</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{ENTITY_LABELS[log.entity] ?? log.entity}</p>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
                  {log.actorName ?? <span className="italic text-xs">Système</span>}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <Details log={log} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}

      {!isError && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} de {totalPages}</span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
