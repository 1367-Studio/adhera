"use client"

import { useState } from "react"
import { toast } from "sonner"
import { SendIcon, AlertTriangleIcon } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { RichTextEditor } from "@/components/ui/rich-text-editor"

interface SendEmailModalProps {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

function hasHtmlContent(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").trim().length > 0
}

export function SendEmailModal({ open, onOpenChange }: SendEmailModalProps) {
  const [subject,     setSubject]     = useState("")
  const [bodyHtml,    setBodyHtml]    = useState("")
  const [sending,     setSending]     = useState(false)
  const [confirming,  setConfirming]  = useState(false)
  const [recipientCount, setRecipientCount] = useState<number | null>(null)

  async function handleConfirm() {
    if (!subject.trim()) {
      toast.error("Renseignez l'objet du message")
      return
    }
    if (!hasHtmlContent(bodyHtml)) {
      toast.error("Rédigez le contenu du message")
      return
    }

    // Fetch recipient count before confirming
    try {
      const res  = await fetch("/api/membres/email/count")
      const data = await res.json()
      setRecipientCount(data.count ?? 0)
    } catch {
      setRecipientCount(null)
    }
    setConfirming(true)
  }

  async function handleSend() {
    setSending(true)
    try {
      const res  = await fetch("/api/membres/email", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ subject, bodyHtml }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Erreur"); return }
      toast.success(`Email envoyé à ${data.sent} membre${data.sent !== 1 ? "s" : ""}`)
      if (data.failed > 0) toast.warning(`${data.failed} envoi${data.failed !== 1 ? "s" : ""} échoué${data.failed !== 1 ? "s" : ""}`)
      setSubject("")
      setBodyHtml("")
      setConfirming(false)
      onOpenChange(false)
    } catch {
      toast.error("Erreur réseau")
    } finally {
      setSending(false)
    }
  }

  function handleClose() {
    if (sending) return
    setConfirming(false)
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleClose}
      title="Envoyer un email"
      size="lg"
      dismissable={!sending}
    >
      {!confirming ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            L'email sera envoyé à tous les <strong>membres actifs ayant une adresse email</strong>.
          </p>

          <FormField
            label="Objet"
            required
            placeholder="Convocation à l'assemblée générale…"
            value={subject}
            onChange={e => setSubject(e.target.value)}
          />

          <RichTextEditor
            label="Message"
            required
            value={bodyHtml}
            onChange={setBodyHtml}
            placeholder="Rédigez votre message…"
            minHeight="200px"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={handleClose}>
              Annuler
            </Button>
            <Button onClick={handleConfirm}>
              <SendIcon className="mr-1.5 size-4" />
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
                {recipientCount !== null
                  ? `Cet email sera envoyé à ${recipientCount} membre${recipientCount !== 1 ? "s" : ""} actif${recipientCount !== 1 ? "s" : ""}. Cette action est irréversible.`
                  : "Cet email sera envoyé à tous les membres actifs. Cette action est irréversible."}
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 space-y-1">
            <p className="text-xs text-muted-foreground">Objet</p>
            <p className="text-sm font-medium">{subject}</p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={sending}>
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
