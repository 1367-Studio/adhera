"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Modal } from "@/components/ui/modal"
import { FormField } from "@/components/ui/form-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { Button } from "@/components/ui/button"

interface Props {
  documentLabel: string
  defaultTo:     string
  open:          boolean
  onOpenChange:  (open: boolean) => void
  onSend:        (to: string, message: string) => Promise<void>
  loading?:      boolean
}

// Recipient always starts pre-filled from the fournisseur's billing/contact email but stays
// editable — a one-off address or a typo fixed on the spot shouldn't require going to edit
// the fournisseur record first. The parent only ever mounts this component once a target
// is picked (`{emailTarget && <SendEmailModal .../>}`), so a fresh `useState` initializer
// is enough — no effect needed to resync on reopen, it's a brand new instance every time.
export function SendEmailModal({ documentLabel, defaultTo, open, onOpenChange, onSend, loading }: Props) {
  const t = useTranslations("documents")
  const tCommon = useTranslations("common")
  const [to, setTo]           = useState(defaultTo)
  const [message, setMessage] = useState("")

  async function handleSend() {
    if (!to.trim()) return
    await onSend(to.trim(), message.trim())
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("sendByEmailTitle", { label: documentLabel })} size="sm">
      <div className="space-y-4">
        <FormField
          label={t("recipient")}
          type="email"
          required
          value={to}
          onChange={e => setTo(e.target.value)}
        />
        <TextareaField
          label={t("messageOptional")}
          rows={3}
          placeholder={t("messagePlaceholder")}
          value={message}
          onChange={e => setMessage(e.target.value)}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {tCommon("cancel")}
          </Button>
          <Button type="button" onClick={handleSend} loading={loading} disabled={!to.trim()}>
            {t("send")}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
