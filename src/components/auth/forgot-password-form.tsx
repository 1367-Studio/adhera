"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { CircleNotchIcon, EnvelopeSimpleIcon, ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { toast } from "sonner"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ForgotPasswordForm() {
  const [email,      setEmail]      = useState("")
  const [loading,    setLoading]    = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [emailError, setEmailError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim())         { setEmailError("Adresse email requise."); return }
    if (!EMAIL_RE.test(email)) { setEmailError("Adresse email invalide."); return }
    setEmailError("")
    setLoading(true)

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email }),
      })
      if (res.status === 503) {
        toast.error("Erreur d'envoi. Veuillez réessayer dans quelques instants.")
        return
      }
      setSubmitted(true)
    } catch {
      toast.error("Erreur réseau. Veuillez réessayer.")
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl border bg-card p-6 space-y-4 text-center">
        <div className="mx-auto size-12 rounded-full bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
          <EnvelopeSimpleIcon className="size-6 text-primary" />
        </div>
        <div className="space-y-1.5">
          <p className="font-medium">Vérifiez votre boite mail</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Si un compte existe avec{" "}
            <span className="font-medium text-foreground">{email}</span>,
            vous recevrez un lien de réinitialisation dans quelques instants.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Pensez à vérifier vos spams.</p>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-3" />
          Retour à la connexion
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <FormField
        label="Adresse email"
        type="email"
        placeholder="contact@association.fr"
        autoComplete="email"
        autoFocus
        leadingIcon={<EnvelopeSimpleIcon />}
        value={email}
        onChange={(e) => { setEmail(e.target.value); setEmailError("") }}
        error={emailError}
      />

      <Button type="submit" className="w-full" disabled={loading}>
        {loading && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
        Envoyer le lien
      </Button>
    </form>
  )
}
