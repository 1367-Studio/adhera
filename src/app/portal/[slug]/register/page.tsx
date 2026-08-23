import { PortalRegisterForm } from "@/components/auth/portal-register-form";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { LogoMark } from "@/components/layout/logo-mark";
import { APP_NAME } from "@/config/brand";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.register")
  return { title: t("pageTitle") }
}

export default async function PortalRegisterPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const t = await getTranslations("portal.register")

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

          <PortalRegisterForm slug={slug} />

          <Link
            href={`/portal/${slug}/login`}
            className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeftIcon className="size-3.5" />
            {t("alreadyAccount")}
          </Link>
        </div>
      </div>
    </div>
  )
}
