import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"
import { APP_NAME } from "@/config/brand"
import { LogoMark } from "@/components/layout/logo-mark"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.forgotPassword")
  return { title: t("pageTitle") }
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const { callbackUrl } = await searchParams
  const backHref = callbackUrl ?? "/login"
  const t = await getTranslations("auth.forgotPassword")

  return (
    <div className="w-full max-w-sm">
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <LogoMark className="size-6" />
        <span className="text-base font-semibold">{APP_NAME}</span>
      </div>

      <div className="rounded-xl border bg-card shadow-sm p-8 space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{t("heading")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>

        <ForgotPasswordForm />

        <Link
          href={backHref}
          className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" />
          {t("backToLogin")}
        </Link>
      </div>
    </div>
  )
}
