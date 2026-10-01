"use client"

import { useTranslations } from "next-intl"
import { DotsSixIcon } from "@phosphor-icons/react/dist/ssr";

export type VariableToken = { token: string; label: string }

// Shared by every place an admin composes email/SMS content with {{token}} substitution
// (template-modal.tsx, send-email-modal.tsx, email-block-editor.tsx's text/button blocks) —
// one list so they can't drift apart. Substitution itself lives in src/lib/automation.ts
// (substituteVars/buildVars), which this list must stay in sync with.
export function getEmailVariableTokens(t: ReturnType<typeof useTranslations>): VariableToken[] {
  return [
    { token: "{{prenom}}",               label: t("messages.templateModal.variables.prenom") },
    { token: "{{nom}}",                  label: t("messages.templateModal.variables.nom") },
    { token: "{{nom_complet}}",          label: t("messages.templateModal.variables.nomComplet") },
    { token: "{{email}}",                label: t("messages.templateModal.variables.email") },
    { token: "{{association}}",          label: t("messages.templateModal.variables.association") },
    { token: "{{lien_portal}}",          label: t("messages.templateModal.variables.lienPortal") },
    { token: "{{annee_cotisation}}",     label: t("messages.templateModal.variables.anneeCotisation") },
    { token: "{{montant_cotisation}}",   label: t("messages.templateModal.variables.montantCotisation") },
    { token: "{{titre_evenement}}",      label: t("messages.templateModal.variables.titreEvenement") },
    { token: "{{date_evenement}}",       label: t("messages.templateModal.variables.dateEvenement") },
    { token: "{{lieu_evenement}}",       label: t("messages.templateModal.variables.lieuEvenement") },
    { token: "{{date_expiration}}",      label: t("messages.templateModal.variables.dateExpiration") },
    { token: "{{lien_renouvellement}}",  label: t("messages.templateModal.variables.lienRenouvellement") },
  ]
}

interface VariableTokenChipsProps {
  tokens: VariableToken[]
  hint?:  string
}

// Draggable — the drop side is generic and already lives in RichTextEditor's own
// handleDrop (src/components/ui/rich-text-editor.tsx), so any RichTextEditor instance
// accepts these without extra wiring. A plain <input>/<textarea> target can read the same
// "text/plain" payload from its own onDrop.
export function VariableTokenChips({ tokens, hint }: VariableTokenChipsProps) {
  return (
    <div className="space-y-1.5">
      {hint && <p className="text-xs font-medium text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap gap-1.5">
        {tokens.map(v => (
          <button
            key={v.token}
            type="button"
            draggable
            onDragStart={e => {
              e.dataTransfer.setData("text/plain", v.token)
              e.dataTransfer.effectAllowed = "copy"
            }}
            className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-mono cursor-grab active:cursor-grabbing select-none hover:bg-muted hover:border-foreground/20 transition-colors"
          >
            <DotsSixIcon className="size-2.5 text-muted-foreground" />
            {v.token}
            <span className="text-muted-foreground ml-0.5 font-sans normal-case">— {v.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
