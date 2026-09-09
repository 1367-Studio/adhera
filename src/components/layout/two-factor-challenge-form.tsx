"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { verifyTwoFactorLogin, cancelTwoFactorLogin, type TwoFactorMethod } from "@/lib/auth/two-factor"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr"

interface Props {
  pendingToken: string
  onBack: () => void
}

export function TwoFactorChallengeForm({ pendingToken, onBack }: Props) {
  const t = useTranslations("auth.login.twoFactor")
  const [method, setMethod]         = useState<TwoFactorMethod>("totp")
  const [code, setCode]             = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setSubmitting(true)
    const result = await verifyTwoFactorLogin(pendingToken, code.trim(), method)
    setSubmitting(false)
    // On success verifyTwoFactorLogin() never actually returns here — its own signIn() call
    // redirects — so reaching this line always means it failed.
    if (!result.ok) {
      toast.error(result.error)
      setCode("")
    }
  }

  function toggleMethod() {
    setMethod((m) => (m === "totp" ? "backup" : "totp"))
    setCode("")
  }

  function handleBack() {
    // Fire-and-forget — tidiness only (see cancelTwoFactorLogin's doc comment), not worth
    // blocking the back navigation on.
    void cancelTwoFactorLogin(pendingToken)
    onBack()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-1">
        <h1 className="text-base font-medium">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {method === "totp" ? t("descriptionTotp") : t("descriptionBackup")}
        </p>
      </div>

      {method === "totp" ? (
        <FormField
          label={t("codeLabel")}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          type="tel"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          maxLength={6}
          autoFocus
          className="text-center font-mono text-lg tracking-[0.3em]"
        />
      ) : (
        <FormField
          label={t("backupCodeLabel")}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 11))}
          autoComplete="off"
          placeholder="XXXXX-XXXXX"
          autoFocus
          className="text-center font-mono tracking-widest"
        />
      )}

      <Button type="submit" className="w-full" disabled={submitting || !code.trim()}>
        {submitting && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
        {t("submit")}
      </Button>

      <div className="flex items-center justify-between text-sm">
        <button
          type="button"
          onClick={handleBack}
          className="text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
        >
          {t("back")}
        </button>
        <button
          type="button"
          onClick={toggleMethod}
          className="text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
        >
          {method === "totp" ? t("useBackupCode") : t("useAuthenticatorCode")}
        </button>
      </div>
    </form>
  )
}
