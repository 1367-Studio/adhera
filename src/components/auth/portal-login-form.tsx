"use client"

import { TwoFactorChallengeForm } from "@/components/layout/two-factor-challenge-form"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { authenticate } from "@/lib/auth/actions"
import { loginSchema, type LoginInput } from "@/lib/schemas"
import { zodResolver } from "@hookform/resolvers/zod"
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr"
import { useTranslations } from "next-intl"
import Link from "next/link"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
export function PortalLoginForm({ slug, callbackUrl }: { slug: string; callbackUrl?: string }) {
  const t = useTranslations("portal.login")
  const [pendingToken, setPendingToken] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    mode:     "onSubmit",
  })

  async function onSubmit(data: LoginInput) {
    const formData = new FormData()
    formData.append("email",    data.email)
    formData.append("password", data.password)
    formData.append("slug",     slug)
    if (callbackUrl) formData.append("callbackUrl", callbackUrl)

    const result = await authenticate(undefined, formData)
    // 2FA is staff-only (see requireStaffSession() in two-factor.ts), but staff can also
    // sign in through this same form on their own association's portal — without this
    // branch, that case silently went nowhere: authenticate() returns requires2FA instead
    // of ever calling signIn(), so ignoring it here meant no session, no error, no redirect.
    if (result?.requires2FA && result.pendingToken) {
      setPendingToken(result.pendingToken)
      return
    }
    if (result?.error) toast.error(result.error)
  }

  if (pendingToken) {
    return <TwoFactorChallengeForm pendingToken={pendingToken} onBack={() => setPendingToken(null)} />
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField
        label={t("emailLabel")}
        type="email"
        placeholder={t("emailPlaceholder")}
        autoComplete="email"
        autoFocus
        required
        error={errors.email?.message}
        {...register("email")}
      />

      <FormField
        label={t("passwordLabel")}
        type="password"
        placeholder="••••••••"
        autoComplete="current-password"
        required
        error={errors.password?.message}
        {...register("password")}
      />

      <Button type="submit" className="w-full mt-2" disabled={isSubmitting}>
        {isSubmitting && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
        {t("signIn")}
      </Button>

      <div className="flex flex-col gap-2 pt-1">
        <Link
          href="/forgot-password"
          className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline transition-colors"
        >
          {t("forgotPassword")}
        </Link>
      </div>
    </form>
  )
}
