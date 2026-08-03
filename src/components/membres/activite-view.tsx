"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useTranslations } from "next-intl"
import { FunnelXIcon, CaretLeftIcon, CaretRightIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"

type Translator = ReturnType<typeof useTranslations>

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
    sent?:              number
    failed?:            number
    recipientMode?:     string
    recipientCount?:    number
    externalEmailCount?: number
    externalEmails?:    string[]
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

function getFieldLabels(t: Translator): Record<string, string> {
  return {
    firstName: t("membres.activityLog.fields.firstName"), lastName: t("membres.activityLog.fields.lastName"),
    name: t("membres.activityLog.fields.name"), email: t("membres.activityLog.fields.email"),
    phone: t("membres.activityLog.fields.phone"), address: t("membres.activityLog.fields.address"),
    birthDate: t("membres.activityLog.fields.birthDate"),
    status: t("membres.activityLog.fields.status"), typeId: t("membres.activityLog.fields.typeId"), role: t("membres.activityLog.fields.role"),
  }
}

function getRoleLabels(t: Translator): Record<string, string> {
  return {
    ADMIN: t("membres.form.role.admin"), PRESIDENT: t("membres.form.role.president"), TRESORIER: t("membres.form.role.tresorier"),
    SECRETAIRE: t("membres.form.role.secretaire"), MEMBRE: t("membres.form.role.membre"),
  }
}

function getStatusLabels(t: Translator): Record<string, string> {
  return {
    ACTIF: t("membres.form.status.actif"), INACTIF: t("membres.form.status.inactif"),
    PENDING: t("membres.form.status.pending"), SUSPENDU: t("membres.form.status.suspendu"),
    EN_ATTENTE: t("membres.form.status.pending"), PAYE: t("membres.activiteView.statusValues.paye"), EXONERE: t("membres.activiteView.statusValues.exonere"),
    PARTIELLEMENT_PAYEE: t("membres.activiteView.statusValues.partiellementPayee"), EN_RETARD: t("membres.activiteView.statusValues.enRetard"), ANNULEE: t("membres.activiteView.statusValues.annulee"),
    ACTIVE: t("membres.form.status.actif"), PAUSED: t("membres.activiteView.statusValues.paused"), DONE: t("membres.activiteView.statusValues.done"),
  }
}

function getRsvpLabels(t: Translator): Record<string, string> {
  return {
    CONFIRME: t("membres.activiteView.rsvp.confirme"), PROVAVEL: t("membres.activiteView.rsvp.provavel"),
    INCERTO: t("membres.activiteView.rsvp.incerto"), ABSENT: t("membres.activiteView.rsvp.absent"),
  }
}

function getActualiteFieldLabels(t: Translator): Record<string, string> {
  return {
    title:         t("membres.activiteView.actualiteFields.title"),
    pinned:        t("membres.activiteView.actualiteFields.pinned"),
    publishedAt:   t("membres.activiteView.actualiteFields.publishedAt"),
    recipientMode: t("membres.activiteView.actualiteFields.recipientMode"),
    content:       t("membres.activiteView.actualiteFields.content"),
  }
}

function getRecipientModeLabels(t: Translator): Record<string, string> {
  return {
    ALL: t("membres.activiteView.recipientModeAll"), SELECTED: t("membres.activiteView.recipientModeSelected"),
  }
}

function formatActualiteValue(field: string, value: string | null, t: Translator): string {
  const recipientModeLabels = getRecipientModeLabels(t)
  if (value === null) {
    if (field === "pinned")      return t("common.no")
    if (field === "publishedAt") return t("membres.activiteView.actualiteValues.draft")
    return "—"
  }
  if (field === "pinned")        return value === "true" ? t("common.yes") : t("common.no")
  if (field === "publishedAt")   return format(new Date(value), "d MMM yyyy", { locale: fr })
  if (field === "recipientMode") return recipientModeLabels[value] ?? value
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

function getActionConfig(t: Translator): Record<string, { label: string; color: string }> {
  return {
    // Membres (blue)
    MEMBRE_CREATED:           { label: t("membres.activiteView.actions.membreCreated"),       color: BLUE   },
    MEMBRE_UPDATED:           { label: t("membres.activiteView.actions.membreUpdated"),      color: BLUE_L },
    MEMBRE_DELETED:           { label: t("membres.activiteView.actions.membreDeleted"),      color: DEL    },
    MEMBRE_PORTAL_REGISTERED: { label: t("membres.activiteView.actions.membrePortalRegistered"),   color: SKY    },
    MEMBRE_INSCRIPTION_REQUESTED: { label: t("membres.activiteView.actions.membreInscriptionRequested"), color: SKY },
    MEMBRE_ROLE_CHANGED:      { label: t("membres.activiteView.actions.membreRoleChanged"),        color: BLUE   },
    MEMBRE_ACCESS_CREATED:    { label: t("membres.activiteView.actions.membreAccessCreated"),          color: BLUE_L },
    PROFIL_UPDATED:           { label: t("membres.activiteView.actions.profilUpdated"),      color: BLUE_L },
    PROFILE_UPDATED:          { label: t("membres.activiteView.actions.profileUpdated"),      color: BLUE_L },
    PASSWORD_CHANGED:         { label: t("membres.activiteView.actions.passwordChanged"), color: SLA   },
    PASSWORD_RESET:           { label: t("membres.activiteView.actions.passwordReset"), color: SLA },
    EMAIL_SENT_BULK:          { label: t("membres.activiteView.actions.emailSentBulk"),       color: AMB_L  },
    SMS_SENT_BULK:            { label: t("membres.activiteView.actions.smsSentBulk"),          color: AMB_L  },
    // Actualités (amber)
    ACTUALITE_CREATED:        { label: t("membres.activiteView.actions.actualiteCreated"),     color: AMB    },
    ACTUALITE_UPDATED:        { label: t("membres.activiteView.actions.actualiteUpdated"),  color: AMB_L  },
    ACTUALITE_DELETED:        { label: t("membres.activiteView.actions.actualiteDeleted"), color: DEL    },
    // Événements (violet)
    EVENEMENT_CREATED:        { label: t("membres.activiteView.actions.evenementCreated"),      color: VIO    },
    EVENEMENT_UPDATED:        { label: t("membres.activiteView.actions.evenementUpdated"),   color: VIO_L  },
    EVENEMENT_DELETED:        { label: t("membres.activiteView.actions.evenementDeleted"),  color: DEL    },
    PRESENCE_MARKED:          { label: t("membres.activiteView.actions.presenceMarked"),    color: TEAL   },
    RSVP_UPDATED:             { label: t("membres.activiteView.actions.rsvpUpdated"),     color: VIO    },
    PARTICIPATION_GUEST_UPDATED: { label: t("membres.activiteView.actions.participationGuestUpdated"),   color: VIO_L  },
    PARTICIPATION_GUEST_REMOVED: { label: t("membres.activiteView.actions.participationGuestRemoved"),    color: DEL    },
    TICKET_CHECKOUT_STARTED:  { label: t("membres.activiteView.actions.ticketCheckoutStarted"),     color: VIO_L  },
    TICKET_PAID:              { label: t("membres.activiteView.actions.ticketPaid"),         color: EME    },
    TICKET_PAYMENT_CANCELLED: { label: t("membres.activiteView.actions.ticketPaymentCancelled"),     color: DEL    },
    TICKET_REFUNDED:          { label: t("membres.activiteView.actions.ticketRefunded"),          color: DEL    },
    EVENEMENT_QR_GENERATED:   { label: t("membres.activiteView.actions.evenementQrGenerated"),  color: VIO    },
    EVENEMENT_QR_REVOKED:     { label: t("membres.activiteView.actions.evenementQrRevoked"), color: SLA_L  },
    // Cotisations (emerald)
    COTISATION_CREATED:       { label: t("membres.activiteView.actions.cotisationCreated"),    color: EME    },
    COTISATION_UPDATED:       { label: t("membres.activiteView.actions.cotisationUpdated"), color: EME_L  },
    COTISATION_DELETED:       { label: t("membres.activiteView.actions.cotisationDeleted"),color: DEL    },
    COTISATION_REFUNDED:      { label: t("membres.activiteView.actions.cotisationRefunded"), color: DEL  },
    // Finances (cyan)
    BANK_ACCOUNT_CREATED:     { label: t("membres.activiteView.actions.bankAccountCreated"),   color: CYA   },
    BANK_ACCOUNT_UPDATED:     { label: t("membres.activiteView.actions.bankAccountUpdated"),  color: CYA_L },
    BANK_ACCOUNT_DELETED:     { label: t("membres.activiteView.actions.bankAccountDeleted"), color: DEL   },
    BANK_STATEMENT_IMPORTED:  { label: t("membres.activiteView.actions.bankStatementImported"),           color: CYA   },
    BANK_TX_STATUS_UPDATED:   { label: t("membres.activiteView.actions.bankTxStatusUpdated"),  color: CYA_L },
    TX_IGNORED:               { label: t("membres.activiteView.actions.txIgnored"),      color: SLA_L },
    TX_MARKED_DUPLICATE:      { label: t("membres.activiteView.actions.txMarkedDuplicate"),          color: SLA_L },
    TX_MATCHED_INCOME:        { label: t("membres.activiteView.actions.txMatchedIncome"),        color: CYA   },
    TX_MATCHED_EXPENSE:       { label: t("membres.activiteView.actions.txMatchedExpense"),        color: CYA   },
    TX_UNMATCHED:             { label: t("membres.activiteView.actions.txUnmatched"),     color: SLA_L },
    INCOME_CREATED:           { label: t("membres.activiteView.actions.incomeCreated"),          color: CYA   },
    INCOME_UPDATED:           { label: t("membres.activiteView.actions.incomeUpdated"),         color: CYA_L },
    INCOME_DELETED:           { label: t("membres.activiteView.actions.incomeDeleted"),          color: DEL   },
    EXPENSE_CREATED:          { label: t("membres.activiteView.actions.expenseCreated"),          color: CYA   },
    EXPENSE_UPDATED:          { label: t("membres.activiteView.actions.expenseUpdated"),         color: CYA_L },
    EXPENSE_DELETED:          { label: t("membres.activiteView.actions.expenseDeleted"),          color: DEL   },
    FINANCE_CATEGORY_CREATED: { label: t("membres.activiteView.actions.financeCategoryCreated"),          color: CYA   },
    FINANCE_CATEGORY_UPDATED: { label: t("membres.activiteView.actions.financeCategoryUpdated"),       color: CYA_L },
    FINANCE_CATEGORY_DELETED: { label: t("membres.activiteView.actions.financeCategoryDeleted"),      color: DEL   },
    PARTIAL_REFUND_RECEIVED:  { label: t("membres.activiteView.actions.partialRefundReceived"),    color: AMB_L },
    EXERCICE_CREATED:         { label: t("membres.activiteView.actions.exerciceCreated"),         color: CYA   },
    EXERCICE_UPDATED:         { label: t("membres.activiteView.actions.exerciceUpdated"),         color: CYA_L },
    EXERCICE_CLOTURE:         { label: t("membres.activiteView.actions.exerciceCloture"),         color: SLA   },
    EXERCICE_REOUVERT:        { label: t("membres.activiteView.actions.exerciceReouvert"),        color: CYA   },
    EXERCICE_DELETED:         { label: t("membres.activiteView.actions.exerciceDeleted"),         color: DEL   },

    // Matériel (orange)
    MATERIEL_CREATED:         { label: t("membres.activiteView.actions.materielCreated"),     color: ORA    },
    MATERIEL_UPDATED:         { label: t("membres.activiteView.actions.materielUpdated"),    color: ORA_L  },
    MATERIEL_DELETED:         { label: t("membres.activiteView.actions.materielDeleted"),   color: DEL    },
    // Prêts (orange / status-based)
    LOAN_CREATED:             { label: t("membres.activiteView.actions.loanCreated"),           color: ORA    },
    LOAN_REQUESTED:           { label: t("membres.activiteView.actions.loanRequested"),        color: YEL    },
    LOAN_CONFIRMED:           { label: t("membres.activiteView.actions.loanConfirmed"),       color: EME    },
    LOAN_REFUSED:             { label: t("membres.activiteView.actions.loanRefused"),         color: DEL    },
    LOAN_RETURNED:            { label: t("membres.activiteView.actions.loanReturned"),          color: TEAL   },
    LOAN_UPDATED:             { label: t("membres.activiteView.actions.loanUpdated"),    color: ORA_L  },
    LOAN_CANCELLED:           { label: t("membres.activiteView.actions.loanCancelled"),     color: DEL    },
    LOAN_DELETED:             { label: t("membres.activiteView.actions.loanDeleted"),       color: DEL    },
    // Modèles (purple)
    TEMPLATE_CREATED:         { label: t("membres.activiteView.actions.templateCreated"),         color: PUR    },
    TEMPLATE_UPDATED:         { label: t("membres.activiteView.actions.templateUpdated"),      color: PUR_L  },
    TEMPLATE_DELETED:         { label: t("membres.activiteView.actions.templateDeleted"),     color: DEL    },
    TEMPLATE_ACTIVATED:       { label: t("membres.activiteView.actions.templateActivated"),       color: PUR    },
    TEMPLATE_DEACTIVATED:     { label: t("membres.activiteView.actions.templateDeactivated"),    color: SLA_L  },
    // Automatisations (indigo)
    RULE_CREATED:             { label: t("membres.activiteView.actions.ruleCreated"),         color: IND    },
    RULE_UPDATED:             { label: t("membres.activiteView.actions.ruleUpdated"),      color: IND_L  },
    RULE_DELETED:             { label: t("membres.activiteView.actions.ruleDeleted"),     color: DEL    },
    AUTOMATION_SKIPPED_NO_CONTACT: { label: t("membres.activiteView.actions.automationSkipped"), color: AMB_L },
    // Types membres (slate)
    TYPE_CREATED:             { label: t("membres.activiteView.actions.typeCreated"),           color: SLA    },
    TYPE_UPDATED:             { label: t("membres.activiteView.actions.typeUpdated"),        color: SLA_L  },
    TYPE_DELETED:             { label: t("membres.activiteView.actions.typeDeleted"),       color: DEL    },
    // Réunions (sky)
    MEETING_CREATED:           { label: t("membres.activiteView.actions.meetingCreated"),              color: SKY   },
    MEETING_UPDATED:           { label: t("membres.activiteView.actions.meetingUpdated"),           color: SKY_L },
    MEETING_DELETED:           { label: t("membres.activiteView.actions.meetingDeleted"),          color: DEL   },
    MEETING_ENDED:             { label: t("membres.activiteView.actions.meetingEnded"),           color: SLA   },
    MEETING_RECORDING_STARTED: { label: t("membres.activiteView.actions.meetingRecordingStarted"),     color: SKY_L },
    MEETING_RECORDING_STOPPED: { label: t("membres.activiteView.actions.meetingRecordingStopped"),      color: SLA   },
    MEETING_TRANSCRIBED:       { label: t("membres.activiteView.actions.meetingTranscribed"),      color: SKY_L },
    MEETING_SUMMARIZED:        { label: t("membres.activiteView.actions.meetingSummarized"),        color: SKY   },
    // Sondages (lime)
    SONDAGE_CREATED:           { label: t("membres.activiteView.actions.sondageCreated"),       color: LIME   },
    SONDAGE_UPDATED:           { label: t("membres.activiteView.actions.sondageUpdated"),    color: LIME_L },
    SONDAGE_DELETED:           { label: t("membres.activiteView.actions.sondageDeleted"),   color: DEL    },
    SONDAGE_ACTIVATED:         { label: t("membres.activiteView.actions.sondageActivated"),     color: LIME   },
    SONDAGE_CLOSED:            { label: t("membres.activiteView.actions.sondageClosed"),      color: SLA    },
    SONDAGE_REPONSE_SUBMITTED: { label: t("membres.activiteView.actions.sondageReponseSubmitted"),    color: LIME_L },
    // Boutique (pink)
    BOUTIQUE_PRODUIT_CREATED:  { label: t("membres.activiteView.actions.boutiqueProduitCreated"),          color: PINK   },
    BOUTIQUE_PRODUIT_UPDATED:  { label: t("membres.activiteView.actions.boutiqueProduitUpdated"),        color: PINK_L },
    BOUTIQUE_PRODUIT_DELETED:  { label: t("membres.activiteView.actions.boutiqueProduitDeleted"),       color: DEL    },
    BOUTIQUE_COMMANDE_CREATED: { label: t("membres.activiteView.actions.boutiqueCommandeCreated"),         color: PINK   },
    BOUTIQUE_COMMANDE_UPDATED: { label: t("membres.activiteView.actions.boutiqueCommandeUpdated"),   color: PINK_L },
    COMMANDE_REFUNDED:         { label: t("membres.activiteView.actions.commandeRefunded"),    color: DEL    },
    // Dons (teal)
    DON_CREATED:               { label: t("membres.activiteView.actions.donCreated"),            color: AMB_L  },
    DON_PAID:                 { label: t("membres.activiteView.actions.donPaid"),             color: TEAL   },
    DON_REFUNDED:              { label: t("membres.activiteView.actions.donRefunded"),       color: DEL    },
    // Cotisation Stripe
    COTISATION_PAID:          { label: t("membres.activiteView.actions.cotisationPaidStripe"), color: EME },
    // Association / Site (rose)
    ASSOCIATION_REGISTERED:   { label: t("membres.activiteView.actions.associationRegistered"),    color: ROSE   },
    ASSOCIATION_UPDATED:      { label: t("membres.activiteView.actions.associationUpdated"),  color: ROSE   },
    SITE_UPDATED:             { label: t("membres.activiteView.actions.siteUpdated"),     color: ROSE   },
    SITE_PUBLISHED:           { label: t("membres.activiteView.actions.sitePublished"),      color: EME    },
    SITE_UNPUBLISHED:         { label: t("membres.activiteView.actions.siteUnpublished"),    color: SLA    },
    SMS_SETTINGS_UPDATED:     { label: t("membres.activiteView.actions.smsSettingsUpdated"),     color: ROSE   },
    AI_CONFIG_UPDATED:        { label: t("membres.activiteView.actions.aiConfigUpdated"),      color: ROSE   },
    LIVEKIT_CONFIG_UPDATED:   { label: t("membres.activiteView.actions.livekitConfigUpdated"),   color: ROSE   },
    // Tickets expirés
    TICKET_CHECKOUT_EXPIRED:  { label: t("membres.activiteView.actions.ticketCheckoutExpired"),      color: DEL    },
  }
}

function getEntityLabels(t: Translator): Record<string, string> {
  return {
    Membre:          t("membres.activiteView.entities.membre"),
    User:            t("membres.activiteView.entities.user"),
    Actualite:       t("membres.activiteView.entities.actualite"),
    Evenement:       t("membres.activiteView.entities.evenement"),
    Participation:   t("membres.activiteView.entities.participation"),
    Cotisation:      t("membres.activiteView.entities.cotisation"),
    Material:        t("membres.activiteView.entities.material"),
    MaterialLoan:    t("membres.activiteView.entities.materialLoan"),
    MessageTemplate: t("membres.activiteView.entities.messageTemplate"),
    AutomationRule:  t("membres.activiteView.entities.automationRule"),
    MembreType:      t("membres.activiteView.entities.membreType"),
    Association:     t("membres.activiteView.entities.association"),
    BoutiqueProduit:  t("membres.activiteView.entities.boutiqueProduit"),
    BoutiqueCommande: t("membres.activiteView.entities.boutiqueCommande"),
    Sondage:          t("membres.activiteView.entities.sondage"),
    SondageReponse:   t("membres.activiteView.entities.sondageReponse"),
    Meeting:          t("membres.activiteView.entities.meeting"),
    Don:              t("membres.activiteView.entities.don"),
    BankAccount:      t("membres.activiteView.entities.bankAccount"),
    BankTransaction:  t("membres.activiteView.entities.bankTransaction"),
    Income:           t("membres.activiteView.entities.income"),
    Expense:          t("membres.activiteView.entities.expense"),
    FinanceCategory:  t("membres.activiteView.entities.financeCategory"),
    Payment:          t("membres.activiteView.entities.payment"),
  }
}

function getGenericFieldLabels(t: Translator): Record<string, Record<string, string>> {
  return {
    EVENEMENT_UPDATED: {
      title: t("membres.activiteView.actualiteFields.title"), date: t("membres.activiteView.columns.date"),
      location: t("membres.activiteView.genericFields.evenementLocation"), price: t("membres.activiteView.genericFields.evenementPrice"),
      capacity: t("membres.activiteView.genericFields.evenementCapacity"),
    },
    COTISATION_UPDATED: {
      status: t("membres.activityLog.fields.status"), amount: t("membres.activiteView.genericFields.cotisationAmount"),
      paidAt: t("membres.activiteView.genericFields.cotisationPaidAt"), note: t("membres.activiteView.genericFields.cotisationNote"),
    },
  }
}

function getEntityOptions(t: Translator): { value: string; label: string }[] {
  const entities = getEntityLabels(t)
  return [
    { value: "Membre",          label: entities.Membre          },
    { value: "User",            label: entities.User            },
    { value: "Actualite",       label: entities.Actualite       },
    { value: "Evenement",       label: entities.Evenement       },
    { value: "Participation",   label: entities.Participation   },
    { value: "Cotisation",      label: entities.Cotisation      },
    { value: "Material",        label: entities.Material        },
    { value: "MaterialLoan",    label: entities.MaterialLoan    },
    { value: "MessageTemplate", label: t("membres.activiteView.messageTemplateFilterLabel") },
    { value: "AutomationRule",  label: entities.AutomationRule  },
    { value: "MembreType",      label: entities.MembreType      },
    { value: "Association",     label: entities.Association     },
    { value: "BoutiqueProduit",  label: entities.BoutiqueProduit  },
    { value: "BoutiqueCommande", label: entities.BoutiqueCommande },
    { value: "Sondage",          label: entities.Sondage          },
    { value: "SondageReponse",   label: entities.SondageReponse   },
    { value: "Meeting",          label: entities.Meeting          },
    { value: "Don",              label: entities.Don              },
    { value: "BankAccount",      label: entities.BankAccount      },
    { value: "BankTransaction",  label: entities.BankTransaction  },
    { value: "Income",           label: entities.Income           },
    { value: "Expense",          label: entities.Expense          },
    { value: "FinanceCategory",  label: entities.FinanceCategory  },
  ]
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ActionBadge({ action, t }: { action: string; t: Translator }) {
  const actionConfig = getActionConfig(t)
  const cfg = actionConfig[action] ?? { label: action, color: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" }
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap", cfg.color)}>
      {cfg.label}
    </span>
  )
}

function formatDiffValue(field: string, value: string | null, statusLabels: Record<string, string>, roleLabels: Record<string, string>, t: Translator): string {
  if (value === null) return "—"
  if (field === "status") return statusLabels[value] ?? value
  if (field === "type")   return value === "ENTREE" ? t("membres.activiteView.entrySortie.entree") : t("membres.activiteView.entrySortie.sortie")
  if (field === "role")   return roleLabels[value] ?? value
  return value
}

function GenericDiff({ changes, fieldLabels, t }: {
  changes: Record<string, { old: string | null; new: string | null }>
  fieldLabels: Record<string, string>
  t: Translator
}) {
  const entries = Object.entries(changes)
  if (entries.length === 0) return <span className="text-muted-foreground text-xs">—</span>
  const statusLabels = getStatusLabels(t)
  const roleLabels = getRoleLabels(t)
  return (
    <div className="space-y-0.5">
      {entries.map(([field, diff]) => (
        <p key={field} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground/80">{fieldLabels[field] ?? field}</span>
          {" "}
          <span className="line-through opacity-50">{formatDiffValue(field, diff.old, statusLabels, roleLabels, t)}</span>
          {" → "}
          <span>{formatDiffValue(field, diff.new, statusLabels, roleLabels, t)}</span>
        </p>
      ))}
    </div>
  )
}

function Details({ log, t }: { log: LogEntry; t: Translator }) {
  const m = log.metadata
  if (!m) return <span className="text-muted-foreground text-xs">—</span>

  if (log.action === "ACTUALITE_UPDATED" && m.changes) {
    const entries = Object.entries(m.changes)
    if (entries.length === 0) return <span className="text-muted-foreground text-xs">—</span>
    const actualiteFieldLabels = getActualiteFieldLabels(t)
    return (
      <div className="space-y-0.5">
        {entries.map(([field, diff]) => (
          <p key={field} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/80">{actualiteFieldLabels[field] ?? field}</span>
            {" "}
            {field === "content" ? (
              <span className="italic">{t("membres.activiteView.actualiteValues.contentChanged")}</span>
            ) : (
              <>
                <span className="line-through opacity-50">{formatActualiteValue(field, diff.old, t)}</span>
                {" → "}
                <span>{formatActualiteValue(field, diff.new, t)}</span>
              </>
            )}
          </p>
        ))}
      </div>
    )
  }

  if (["MEMBRE_UPDATED", "PROFIL_UPDATED", "PROFILE_UPDATED", "MEMBRE_ROLE_CHANGED"].includes(log.action) && m.changes) {
    return <GenericDiff changes={m.changes} fieldLabels={getFieldLabels(t)} t={t} />
  }

  const genericLabels = getGenericFieldLabels(t)[log.action]
  if (genericLabels && m.changes) {
    return <GenericDiff changes={m.changes} fieldLabels={genericLabels} t={t} />
  }

  if (log.action === "AUTOMATION_SKIPPED_NO_CONTACT" && m.skippedNoContact != null) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("membres.activiteView.automationSkippedNoContact", { skipped: m.skippedNoContact, total: m.birthdaysToday ?? 0 })}
      </p>
    )
  }

  if ((log.action === "EMAIL_SENT_BULK" || log.action === "SMS_SENT_BULK") && m.sent != null) {
    const bulkModeLabels: Record<string, string> = {
      all:    t("membres.activiteView.bulkSend.modeAll"),
      type:   t("membres.activiteView.bulkSend.modeType"),
      manual: t("membres.activiteView.bulkSend.modeManual"),
    }
    const modeLabel = m.recipientMode ? (bulkModeLabels[m.recipientMode] ?? m.recipientMode) : null
    return (
      <div className="space-y-0.5">
        <p className="text-xs text-muted-foreground">
          {t("membres.activiteView.bulkSend.summary", { sent: m.sent })}
          {m.failed ? ` · ${t("membres.activiteView.bulkSend.failedSuffix", { failed: m.failed })}` : ""}
          {modeLabel ? ` — ${modeLabel}` : ""}
        </p>
        {m.externalEmails && m.externalEmails.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("membres.activiteView.bulkSend.externalEmails", { emails: m.externalEmails.join(", ") })}
          </p>
        )}
      </div>
    )
  }

  if (m.status) {
    const statusLabels = getStatusLabels(t)
    return (
      <p className="text-xs text-muted-foreground">
        {m.oldStatus && <><span className="line-through opacity-50">{statusLabels[m.oldStatus] ?? m.oldStatus}</span>{" → "}</>}
        <span>{statusLabels[m.status] ?? m.status}</span>
      </p>
    )
  }

  if (m.amount != null && !m.changes) {
    return <p className="text-xs text-muted-foreground">{Number(m.amount).toFixed(2)} €</p>
  }

  if (m.rsvp) {
    const rsvpLabels = getRsvpLabels(t)
    return <p className="text-xs text-muted-foreground">{t("membres.activiteView.detailsRsvpLabel")} <span className="font-medium">{rsvpLabels[m.rsvp] ?? m.rsvp}</span></p>
  }

  if (m.present !== undefined) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className={m.present ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
          {m.present ? t("membres.activiteView.detailsPresent") : t("membres.activiteView.rsvp.absent")}
        </span>
        {m.memberName ? ` — ${m.memberName}` : ""}
      </p>
    )
  }

  if (m.quantity !== undefined) {
    return <p className="text-xs text-muted-foreground">{t("membres.activiteView.detailsQuantityLabel", { qty: m.quantity })}</p>
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
  const t = useTranslations()
  const [page,   setPage]   = useState(1)
  const [entity, setEntity] = useState("")
  const [from,   setFrom]   = useState("")
  const [to,     setTo]     = useState("")

  const hasFilters = !!(entity || from || to)
  const entityLabels = getEntityLabels(t)
  const entityOptions = getEntityOptions(t)

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
        title={t("membres.activiteView.title")}
        description={isLoading ? "…" : isError ? "—" : t("membres.activiteView.actionsCount", { count: total })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect value={entity} onChange={v => { setEntity(v); setPage(1) }} options={entityOptions} placeholder={t("membres.activiteView.allModules")} />

        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground">{t("membres.activiteView.fromLabel")}</label>
          <input type="date" value={from} max={to || undefined}
            onChange={e => { setFrom(e.target.value); setPage(1) }}
            className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring w-36"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground">{t("membres.activiteView.toLabel")}</label>
          <input type="date" value={to} min={from || undefined}
            onChange={e => { setTo(e.target.value); setPage(1) }}
            className="h-9 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring w-36"
          />
        </div>

        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={resetFilters} className="h-9 gap-1.5 text-muted-foreground">
            <FunnelXIcon className="size-3.5" />
            {t("membres.activiteView.resetFilters")}
          </Button>
        )}
      </div>

      {isError && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-center gap-2">
            <WarningCircleIcon className="size-4 shrink-0" />
            {t("membres.activiteView.errorLoading")}
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()} className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/10">
            {t("membres.activiteView.retry")}
          </Button>
        </div>
      )}

      {!isError && <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-36">{t("membres.activiteView.columns.date")}</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-36">{t("membres.activiteView.columns.action")}</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{t("membres.activiteView.columns.element")}</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground w-32 hidden md:table-cell">{t("membres.activiteView.columns.by")}</th>
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground hidden lg:table-cell">{t("membres.activiteView.columns.details")}</th>
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
                  {t("membres.activiteView.noActivityFound")}
                </td>
              </tr>
            )}

            {!isLoading && logs.map(log => (
              <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(log.createdAt), "d MMM yyyy, HH:mm", { locale: fr })}
                </td>
                <td className="px-4 py-3">
                  <ActionBadge action={log.action} t={t} />
                </td>
                <td className="px-4 py-3 max-w-[200px]">
                  <p className="font-medium truncate">
                    {log.label ?? <span className="text-muted-foreground italic text-xs">{t("membres.activiteView.deletedElement")}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{entityLabels[log.entity] ?? log.entity}</p>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
                  {log.actorName ?? <span className="italic text-xs">{t("membres.activiteView.system")}</span>}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <Details log={log} t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}

      {!isError && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{t("membres.activiteView.pageOf", { page, totalPages })}</span>
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
