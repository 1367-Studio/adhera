import type { Metadata } from "next"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { RegisterForm } from "@/components/auth/register-form"
import { getPricingInfo } from "@/lib/stripe"
import { APP_NAME } from "@/config/brand"
import { LogoMark } from "@/components/layout/logo-mark"
import { ContactSupportTrigger } from "@/components/auth/contact-support-trigger"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.register")
  return { title: t("pageTitle") }
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ offer?: string }>
}) {
  const [{ offer }, pricing, t] = await Promise.all([searchParams, getPricingInfo(), getTranslations("auth.register")])
  // A custom-pricing offer link (?offer=<token>) replaces the trial entirely — see
  // /api/register's offerToken branch — so this static header must not promise "15 jours
  // d'essai gratuit" when it doesn't apply. Checked on the query param alone (not
  // validity, which RegisterForm resolves client-side) since even an invalid/expired
  // link shouldn't show trial copy while RegisterForm renders its own error state below.
  const hasOffer = !!offer

  return (
    <div className="w-full max-w-md">
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <LogoMark className="size-6" />
        <span className="text-base font-semibold">{APP_NAME}</span>
      </div>

      <div className="rounded-lg border bg-card p-8 space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{t("heading")}</h1>
          <p className="text-sm text-muted-foreground">
            {hasOffer ? t("subtitleOffer") : t("subtitle", { trialDays: pricing.trialDays })}
          </p>
        </div>

        <RegisterForm pricing={pricing} />

        <div className="space-y-2">
          <p className="text-center text-sm text-muted-foreground">
            {t("alreadyAccount")}{" "}
            <Link href="/login" className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80 transition-colors">
              {t("signIn")}
            </Link>
          </p>
          <ContactSupportTrigger />
        </div>
      </div>
    </div>
  )
}
