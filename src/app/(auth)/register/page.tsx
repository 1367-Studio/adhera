import type { Metadata } from "next"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { RegisterForm } from "@/components/auth/register-form"
import { getPricingInfo } from "@/lib/stripe"
import { APP_NAME } from "@/config/brand"
import { LogoMark } from "@/components/layout/logo-mark"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.register")
  return { title: t("pageTitle") }
}

export default async function RegisterPage() {
  const [pricing, t] = await Promise.all([getPricingInfo(), getTranslations("auth.register")])

  return (
    <div className="w-full max-w-md">
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <LogoMark className="size-6" />
        <span className="text-base font-semibold">{APP_NAME}</span>
      </div>

      <div className="rounded-xl border bg-card shadow-sm p-8 space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{t("heading")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("subtitle", { trialDays: pricing.trialDays })}
          </p>
        </div>

        <RegisterForm pricing={pricing} />

        <p className="text-center text-sm text-muted-foreground">
          {t("alreadyAccount")}{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80 transition-colors">
            {t("signIn")}
          </Link>
        </p>
      </div>
    </div>
  )
}
