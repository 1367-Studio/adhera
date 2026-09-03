"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr";

interface Props {
  onClose: () => void
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Errors = Partial<Record<"name" | "email" | "message", string>>

export function ContactSupportModal({ onClose }: Props) {
  const t = useTranslations("auth.contact")
  const tCommon = useTranslations("common")
  const [name,    setName]    = useState("")
  const [email,   setEmail]   = useState("")
  const [message, setMessage] = useState("")
  const [errors,  setErrors]  = useState<Errors>({})
  const [loading, setLoading] = useState(false)
  const [sent,    setSent]    = useState(false)

  function clearError(f: keyof Errors) {
    setErrors((p) => { const e = { ...p }; delete e[f]; return e })
  }

  function validate(): boolean {
    const e: Errors = {}
    if (!name.trim())    e.name    = t("form.nameRequired")
    if (!email.trim())   e.email   = t("form.emailRequired")
    else if (!EMAIL_RE.test(email)) e.email = t("form.emailInvalid")
    if (!message.trim()) e.message = t("form.messageRequired")
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setLoading(true)
    try {
      const res = await fetch("/api/auth/contact", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name, email, message }),
      })
      if (!res.ok) {
        toast.error(t("form.sendError"))
        return
      }
      setSent(true)
    } catch {
      toast.error(t("form.networkError"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        {sent ? (
          <>
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <CheckCircleIcon className="size-10 text-primary" />
              <div className="space-y-1">
                <p className="font-medium">{t("sent.title")}</p>
                <p className="text-sm text-muted-foreground">{t("sent.description")}</p>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>{t("sent.close")}</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("description")}</DialogDescription>
            </DialogHeader>

            <form
              className="space-y-4 py-1"
              onSubmit={(e) => { e.preventDefault(); handleSubmit() }}
            >
              <FormField
                label={t("form.nameLabel")}
                value={name}
                onChange={(e) => { setName(e.target.value); clearError("name") }}
                error={errors.name}
                autoFocus
              />
              <FormField
                label={t("form.emailLabel")}
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); clearError("email") }}
                error={errors.email}
              />
              <TextareaField
                label={t("form.messageLabel")}
                value={message}
                onChange={(e) => { setMessage(e.target.value); clearError("message") }}
                error={errors.message}
                rows={4}
              />

              {/* Hidden submit so Enter works */}
              <button type="submit" className="hidden" aria-hidden />
            </form>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={loading}>{tCommon("cancel")}</Button>
              <Button onClick={handleSubmit} loading={loading}>{t("form.submit")}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
