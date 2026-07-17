"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { FunnelXIcon, CaretLeftIcon, CaretRightIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
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
    skippedNoContact?: number
    birthdaysToday?:   number
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
  firstName: "Prénom", lastName: "Nom", name: "Nom", email: "Email",
  phone: "Téléphone", address: "Adresse", birthDate: "Date de naissance",
  status: "Statut", typeId: "Type", role: "Rôle",
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin", PRESIDENT: "Président", TRESORIER: "Trésorier",
  SECRETAIRE: "Secrétaire", MEMBRE: "Membre",
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
const SKY_L = "bg-sky-50 text-sky-600 dark:bg-sky-900/20 dark:text-sky-400"
const PINK = "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300"
const PINK_L = "bg-pink-50 text-pink-600 dark:bg-pink-900/20 dark:text-pink-400"
const LIME = "bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-300"
const LIME_L = "bg-lime-50 text-lime-600 dark:bg-lime-900/20 dark:text-lime-400"
const CYA  = "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300"
const CYA_L = "bg-cyan-50 text-cyan-600 dark:bg-cyan-900/20 dark:text-cyan-400"
const YEL  = "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300"

const ACTION_CONFIG: Record<string, { label: string; color: string }> = {
  // Membres (blue)
  MEMBRE_CREATED:           { label: "Membre ajouté",       color: BLUE   },
  MEMBRE_UPDATED:           { label: "Membre modifié",      color: BLUE_L },
  MEMBRE_DELETED:           { label: "Membre archivé",      color: DEL    },
  MEMBRE_PORTAL_REGISTERED: { label: "Inscrit (portail)",   color: SKY    },
  MEMBRE_INSCRIPTION_REQUESTED: { label: "Demande d'adhésion (site)", color: SKY },
  MEMBRE_ROLE_CHANGED:      { label: "Rôle modifié",        color: BLUE   },
  MEMBRE_ACCESS_CREATED:    { label: "Accès créé",          color: BLUE_L },
  PROFIL_UPDATED:           { label: "Profil modifié",      color: BLUE_L },
  PROFILE_UPDATED:          { label: "Profil modifié",      color: BLUE_L },
  PASSWORD_CHANGED:         { label: "Mot de passe modifié", color: SLA   },
  PASSWORD_RESET:           { label: "Mot de passe réinitialisé", color: SLA },
  EMAIL_SENT_BULK:          { label: "E-mail envoyé",       color: AMB_L  },
  SMS_SENT_BULK:            { label: "SMS envoyé",          color: AMB_L  },
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
  PARTICIPATION_GUEST_UPDATED: { label: "Invité modifié",   color: VIO_L  },
  PARTICIPATION_GUEST_REMOVED: { label: "Invité retiré",    color: DEL    },
  TICKET_CHECKOUT_STARTED:  { label: "Paiement initié",     color: VIO_L  },
  TICKET_PAID:              { label: "Ticket payé",         color: EME    },
  TICKET_PAYMENT_CANCELLED: { label: "Paiement annulé",     color: DEL    },
  TICKET_REFUNDED:          { label: "Ticket remboursé",    color: DEL    },
  EVENEMENT_QR_GENERATED:   { label: "QR check-in généré",  color: VIO    },
  EVENEMENT_QR_REVOKED:     { label: "QR check-in révoqué", color: SLA_L  },
  // Cotisations (emerald)
  COTISATION_CREATED:       { label: "Cotisation créée",    color: EME    },
  COTISATION_UPDATED:       { label: "Cotisation modifiée", color: EME_L  },
  COTISATION_DELETED:       { label: "Cotisation supprimée",color: DEL    },
  COTISATION_REFUNDED:      { label: "Cotisation remboursée", color: DEL  },
  // Finances (cyan)
  BANK_ACCOUNT_CREATED:     { label: "Compte bancaire ajouté",   color: CYA   },
  BANK_ACCOUNT_UPDATED:     { label: "Compte bancaire modifié",  color: CYA_L },
  BANK_ACCOUNT_DELETED:     { label: "Compte bancaire supprimé", color: DEL   },
  BANK_STATEMENT_IMPORTED:  { label: "Relevé importé",           color: CYA   },
  BANK_TX_STATUS_UPDATED:   { label: "Transaction mise à jour",  color: CYA_L },
  TX_IGNORED:               { label: "Transaction ignorée",      color: SLA_L },
  TX_MARKED_DUPLICATE:      { label: "Marquée doublon",          color: SLA_L },
  TX_MATCHED_INCOME:        { label: "Recette conciliée",        color: CYA   },
  TX_MATCHED_EXPENSE:       { label: "Dépense conciliée",        color: CYA   },
  TX_UNMATCHED:             { label: "Conciliation annulée",     color: SLA_L },
  INCOME_CREATED:           { label: "Recette ajoutée",          color: CYA   },
  INCOME_UPDATED:           { label: "Recette modifiée",         color: CYA_L },
  INCOME_DELETED:           { label: "Recette supprimée",        color: DEL   },
  EXPENSE_CREATED:          { label: "Dépense ajoutée",          color: CYA   },
  EXPENSE_UPDATED:          { label: "Dépense modifiée",         color: CYA_L },
  EXPENSE_DELETED:          { label: "Dépense supprimée",        color: DEL   },
  FINANCE_CATEGORY_CREATED: { label: "Catégorie créée",          color: CYA   },
  FINANCE_CATEGORY_UPDATED: { label: "Catégorie modifiée",       color: CYA_L },
  FINANCE_CATEGORY_DELETED: { label: "Catégorie supprimée",      color: DEL   },
  PARTIAL_REFUND_RECEIVED:  { label: "Remboursement partiel",    color: AMB_L },
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
  TEMPLATE_ACTIVATED:       { label: "Modèle activé",       color: PUR    },
  TEMPLATE_DEACTIVATED:     { label: "Modèle désactivé",    color: SLA_L  },
  // Automatisations (indigo)
  RULE_CREATED:             { label: "Règle créée",         color: IND    },
  RULE_UPDATED:             { label: "Règle modifiée",      color: IND_L  },
  RULE_DELETED:             { label: "Règle supprimée",     color: DEL    },
  AUTOMATION_SKIPPED_NO_CONTACT: { label: "Envoi(s) ignoré(s) — sans contact", color: AMB_L },
  // Types membres (slate)
  TYPE_CREATED:             { label: "Type créé",           color: SLA    },
  TYPE_UPDATED:             { label: "Type modifié",        color: SLA_L  },
  TYPE_DELETED:             { label: "Type supprimé",       color: DEL    },
  // Réunions (sky)
  MEETING_CREATED:           { label: "Réunion créée",              color: SKY   },
  MEETING_UPDATED:           { label: "Réunion modifiée",           color: SKY_L },
  MEETING_DELETED:           { label: "Réunion supprimée",          color: DEL   },
  MEETING_ENDED:             { label: "Réunion terminée",           color: SLA   },
  MEETING_RECORDING_STARTED: { label: "Enregistrement démarré",     color: SKY_L },
  MEETING_RECORDING_STOPPED: { label: "Enregistrement arrêté",      color: SLA   },
  MEETING_TRANSCRIBED:       { label: "Transcription générée",      color: SKY_L },
  MEETING_SUMMARIZED:        { label: "Compte-rendu généré",        color: SKY   },
  // Sondages (lime)
  SONDAGE_CREATED:           { label: "Sondage créé",       color: LIME   },
  SONDAGE_UPDATED:           { label: "Sondage modifié",    color: LIME_L },
  SONDAGE_DELETED:           { label: "Sondage supprimé",   color: DEL    },
  SONDAGE_ACTIVATED:         { label: "Sondage activé",     color: LIME   },
  SONDAGE_CLOSED:            { label: "Sondage fermé",      color: SLA    },
  SONDAGE_REPONSE_SUBMITTED: { label: "Réponse soumise",    color: LIME_L },
  // Boutique (pink)
  BOUTIQUE_PRODUIT_CREATED:  { label: "Produit créé",          color: PINK   },
  BOUTIQUE_PRODUIT_UPDATED:  { label: "Produit modifié",        color: PINK_L },
  BOUTIQUE_PRODUIT_DELETED:  { label: "Produit supprimé",       color: DEL    },
  BOUTIQUE_COMMANDE_CREATED: { label: "Commande créée",         color: PINK   },
  BOUTIQUE_COMMANDE_UPDATED: { label: "Commande mise à jour",   color: PINK_L },
  COMMANDE_REFUNDED:         { label: "Commande remboursée",    color: DEL    },
  // Dons (teal)
  DON_CREATED:               { label: "Don créé",            color: AMB_L  },
  DON_PAID:                 { label: "Don reçu",             color: TEAL   },
  DON_REFUNDED:              { label: "Don remboursé",       color: DEL    },
  // Cotisation Stripe
  COTISATION_PAID:          { label: "Cotisation payée (Stripe)", color: EME },
  // Association / Site (rose)
  ASSOCIATION_REGISTERED:   { label: "Association créée",    color: ROSE   },
  ASSOCIATION_UPDATED:      { label: "Paramètres modifiés",  color: ROSE   },
  SITE_UPDATED:             { label: "Site web modifié",     color: ROSE   },
  SITE_PUBLISHED:           { label: "Site web publié",      color: EME    },
  SITE_UNPUBLISHED:         { label: "Site web dépublié",    color: SLA    },
  SMS_SETTINGS_UPDATED:     { label: "SMS — paramètres",     color: ROSE   },
  AI_CONFIG_UPDATED:        { label: "IA — paramètres",      color: ROSE   },
  LIVEKIT_CONFIG_UPDATED:   { label: "Visio — paramètres",   color: ROSE   },
  // Tickets expirés
  TICKET_CHECKOUT_EXPIRED:  { label: "Paiement expiré",      color: DEL    },
}

const ENTITY_LABELS: Record<string, string> = {
  Membre:          "Membres",
  User:            "Comptes",
  Actualite:       "Actualités",
  Evenement:       "Événements",
  Participation:   "Présences / RSVP",
  Cotisation:      "Cotisations",
  Material:        "Matériel",
  MaterialLoan:    "Prêts",
  MessageTemplate: "Modèles",
  AutomationRule:  "Automatisations",
  MembreType:      "Types membres",
  Association:     "Paramètres",
  BoutiqueProduit:  "Boutique – Produits",
  BoutiqueCommande: "Boutique – Commandes",
  Sondage:          "Sondages",
  SondageReponse:   "Sondages – Réponses",
  Meeting:          "Réunions",
  Don:              "Dons",
  BankAccount:      "Comptes bancaires",
  BankTransaction:  "Transactions bancaires",
  Income:           "Recettes",
  Expense:          "Dépenses",
  FinanceCategory:  "Catégories finances",
  Payment:          "Paiements",
}

const GENERIC_FIELD_LABELS: Record<string, Record<string, string>> = {
  EVENEMENT_UPDATED: {
    title: "Titre", date: "Date", location: "Lieu", price: "Prix", capacity: "Capacité",
  },
  COTISATION_UPDATED: {
    status: "Statut", amount: "Montant", paidAt: "Date paiement", note: "Note",
  },
}

const ENTITY_OPTIONS = [
  { value: "Membre",          label: "Membres"          },
  { value: "User",            label: "Comptes"          },
  { value: "Actualite",       label: "Actualités"       },
  { value: "Evenement",       label: "Événements"       },
  { value: "Participation",   label: "Présences / RSVP" },
  { value: "Cotisation",      label: "Cotisations"      },
  { value: "Material",        label: "Matériel"         },
  { value: "MaterialLoan",    label: "Prêts"            },
  { value: "MessageTemplate", label: "Modèles msg"      },
  { value: "AutomationRule",  label: "Automatisations"  },
  { value: "MembreType",      label: "Types membres"    },
  { value: "Association",     label: "Paramètres"       },
  { value: "BoutiqueProduit",  label: "Boutique – Produits"   },
  { value: "BoutiqueCommande", label: "Boutique – Commandes"  },
  { value: "Sondage",          label: "Sondages"              },
  { value: "SondageReponse",   label: "Sondages – Réponses"   },
  { value: "Meeting",          label: "Réunions"              },
  { value: "Don",              label: "Dons"                  },
  { value: "BankAccount",      label: "Comptes bancaires"     },
  { value: "BankTransaction",  label: "Transactions bancaires" },
  { value: "Income",           label: "Recettes"               },
  { value: "Expense",          label: "Dépenses"               },
  { value: "FinanceCategory",  label: "Catégories finances"    },
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

function formatDiffValue(field: string, value: string | null): string {
  if (value === null) return "—"
  if (field === "status") return STATUS_LABELS[value] ?? value
  if (field === "type")   return value === "ENTREE" ? "Entrée" : "Sortie"
  if (field === "role")   return ROLE_LABELS[value] ?? value
  return value
}

function GenericDiff({ changes, fieldLabels }: {
  changes: Record<string, { old: string | null; new: string | null }>
  fieldLabels: Record<string, string>
}) {
  const entries = Object.entries(changes)
  if (entries.length === 0) return <span className="text-muted-foreground text-xs">—</span>
  return (
    <div className="space-y-0.5">
      {entries.map(([field, diff]) => (
        <p key={field} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{fieldLabels[field] ?? field}</span>
          {" "}
          <span className="line-through opacity-50">{formatDiffValue(field, diff.old)}</span>
          {" → "}
          <span>{formatDiffValue(field, diff.new)}</span>
        </p>
      ))}
    </div>
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

  if (["MEMBRE_UPDATED", "PROFIL_UPDATED", "PROFILE_UPDATED", "MEMBRE_ROLE_CHANGED"].includes(log.action) && m.changes) {
    return <GenericDiff changes={m.changes} fieldLabels={FIELD_LABELS} />
  }

  const genericLabels = GENERIC_FIELD_LABELS[log.action]
  if (genericLabels && m.changes) {
    return <GenericDiff changes={m.changes} fieldLabels={genericLabels} />
  }

  if (log.action === "AUTOMATION_SKIPPED_NO_CONTACT" && m.skippedNoContact != null) {
    return (
      <p className="text-xs text-muted-foreground">
        {m.skippedNoContact} / {m.birthdaysToday} anniversaire{(m.birthdaysToday ?? 0) > 1 ? "s" : ""} du jour ignoré{m.skippedNoContact > 1 ? "s" : ""} — membre sans email/téléphone joignable.
      </p>
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

  if (m.amount != null && !m.changes) {
    return <p className="text-xs text-muted-foreground">{Number(m.amount).toFixed(2)} €</p>
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
            <FunnelXIcon className="size-3.5" />
            Réinitialiser
          </Button>
        )}
      </div>

      {isError && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <WarningCircleIcon className="size-4 shrink-0" />
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
              <CaretLeftIcon className="size-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <CaretRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
