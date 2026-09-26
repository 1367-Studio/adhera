"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { CircleNotchIcon, EnvelopeSimpleIcon, ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { toast } from "sonner"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// `header` / `footer` are the page's title and back/support links, rendered here so the
// "email sent" screen can drop them (it has its own back link).
type ForgotPasswordFormProps = { header?: ReactNode; footer?: ReactNode }

export function ForgotPasswordForm({ header, footer }: ForgotPasswordFormProps) {
  const t = useTranslations("auth.forgotPassword")
  const [email,      setEmail]      = useState("")
  const [loading,    setLoading]    = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [emailError, setEmailError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim())         { setEmailError(t("form.emailRequired")); return }
    if (!EMAIL_RE.test(email)) { setEmailError(t("form.emailInvalid")); return }
    setEmailError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email }),
      })
      if (res.status === 503) {
        toast.error(t("form.sendError"))
        return
      }
      setSubmitted(true)
    } catch {
      toast.error(t("form.networkError"))
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="mx-auto size-12 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
          <EnvelopeSimpleIcon className="size-6 text-primary" />
        </div>
        <div className="space-y-1.5">
          <p className="font-medium">{t("sent.title")}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t.rich("sent.description", {
              email,
              b: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
            })}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">{t("sent.checkSpam")}</p>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-3" />
          {t("backToLogin")}
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {header}
      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <FormField
          label={t("form.emailLabel")}
          type="email"
          placeholder={t("form.emailPlaceholder")}
          autoComplete="email"
          autoFocus
          leadingIcon={<EnvelopeSimpleIcon />}
          value={email}
          onChange={(e) => { setEmail(e.target.value); setEmailError("") }}
          error={emailError}
        />

        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
          {t("form.submit")}
        </Button>
      </form>
      {footer}
    </div>
  )
}
