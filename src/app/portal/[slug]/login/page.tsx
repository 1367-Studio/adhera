import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { PortalLoginForm } from "@/components/auth/portal-login-form"
import { APP_NAME } from "@/config/brand"
import { LogoMark } from "@/components/layout/logo-mark"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.login")
  return { title: t("pageTitle") }
}

export default async function PortalLoginPage({
  params,
  searchParams,
}: {
  params:       Promise<{ slug: string }>
  searchParams: Promise<{ callbackUrl?: string; suspended?: string }>
}) {
  const { slug }                    = await params
  const { callbackUrl, suspended }  = await searchParams
  const t = await getTranslations("portal.login")

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <LogoMark className="size-6" />
            <span className="text-base font-semibold">{APP_NAME}</span>
          </div>
          <LocaleSwitcher />
        </div>

        <div className="rounded-lg border bg-card p-8 space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>

          {suspended && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t("suspendedNotice")}
            </p>
          )}

          <PortalLoginForm slug={slug} callbackUrl={callbackUrl} />
        </div>
      </div>
    </div>
  )
}
