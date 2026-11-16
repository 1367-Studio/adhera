"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr"
import { platformLegalCheckboxLabel, type PlatformLegalDocumentDef } from "@/lib/legal/platform-documents"
import { BASE_PATH } from "@/lib/env"

type Props = {
  show:            boolean
  documents:       PlatformLegalDocumentDef[]
  associationName: string
  userName:        string
}

// FORM-113: blocks the dashboard for the handful of accounts with requiresLegalValidation
// set, until every one of Formwise's own legal documents still pending (src/app/dashboard/
// layout.tsx computes `documents` fresh on every request) is confirmed. `locked` — no X,
// Escape, or backdrop click — the one way out is a successful submit, same as
// SubscriptionUpgradeModal.
export function PlatformLegalValidationModal({ show, documents, associationName, userName }: Props) {
  const router = useRouter()
  const [open, setOpen]           = useState(show)
  const [checked, setChecked]     = useState<Record<string, boolean>>({})
  const [submitting, setSubmitting] = useState(false)

  const allChecked = documents.length > 0 && documents.every(document => checked[document.slug])

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const response = await fetch(`${BASE_PATH}/api/dashboard/legal/platform-validate`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          confirmed: documents.map(document => ({ slug: document.slug, version: document.version })),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? "La validation n’a pas pu être enregistrée. Veuillez réessayer.")
      setOpen(false)
      // The gate lives in a server layout, so the server has to re-evaluate what is pending.
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "La validation n’a pas pu être enregistrée. Veuillez réessayer.")
      setSubmitting(false)
      // A failure can mean the documents' versions moved on (resolvePlatformConfirmations'
      // STALE case) between this page loading and the submit — refresh so `documents` comes
      // back current. The modal itself doesn't unmount (still pending either way), and
      // `checked` stays keyed by slug, so the user's ticks survive and they can just retry.
      router.refresh()
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      locked
      size="lg"
      title="Mise à jour des documents légaux de Formwise"
      description={`Les documents légaux de Formwise ont été mis à jour. Veuillez en prendre connaissance, puis cochez les cases ci-dessous et confirmez la validation au nom de ${associationName} pour accéder à votre espace.`}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2">
          <span className="text-xs text-muted-foreground">Compte connecté</span>
          <span className="text-sm font-medium">{userName}</span>
        </div>

        <div className="divide-y divide-border">
          {documents.map(document => (
            <div key={document.slug} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <CheckboxField
                checked={!!checked[document.slug]}
                disabled={submitting}
                onChange={event => setChecked(prev => ({ ...prev, [document.slug]: event.target.checked }))}
                label={platformLegalCheckboxLabel(document, associationName)}
              />
              {document.consultUrl && (
                <a
                  href={document.consultUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-sm text-primary underline underline-offset-2"
                >
                  Consulter
                </a>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={!allChecked || submitting}>
            {submitting && <CircleNotchIcon className="animate-spin" />}
            Confirmer la validation
          </Button>
        </div>
      </div>
    </Modal>
  )
}
