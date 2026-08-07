import type { Metadata } from "next"
import Link from "next/link"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { getTranslations } from "next-intl/server"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"
import { APP_NAME } from "@/config/brand"
import { LogoMark } from "@/components/layout/logo-mark"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.resetPassword")
  return { title: t("pageTitle") }
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  const t = await getTranslations("auth.resetPassword")

  return (
    <div className="w-full max-w-sm">
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <LogoMark className="size-6" />
        <span className="text-base font-semibold">{APP_NAME}</span>
      </div>

      <div className="rounded-xl border bg-card shadow-sm p-8 space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{t("heading")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>

        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-3 text-sm text-destructive">
            <WarningCircleIcon className="size-4 shrink-0" />
            <span>{t("invalidLink")}</span>
          </div>
        )}

        <Link
          href="/forgot-password"
          className="flex items-center justify-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("requestNewLink")}
        </Link>
      </div>
    </div>
  )
}
