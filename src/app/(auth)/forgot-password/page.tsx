import { ContactSupportTrigger } from "@/components/auth/contact-support-trigger";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { LogoMark } from "@/components/layout/logo-mark";
import { APP_NAME } from "@/config/brand";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.forgotPassword")
  return { title: t("pageTitle") }
}

// Everyone — staff or a member coming from an association's portal — signs back in on the
// shared /login, so there is no per-origin return address here.
export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth.forgotPassword")

  return (
    <div className="w-full max-w-sm">
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <LogoMark className="size-6" />
        <span className="text-base font-semibold">{APP_NAME}</span>
      </div>

      {/* Header and footer go through the form so its "email sent" screen can hide them. */}
      <ForgotPasswordForm
        header={
          <div className="space-y-3.5">
            <h1 className="text-xl font-semibold tracking-tight">{t("heading")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>
        }
        footer={
          <div className="space-y-2">
            <Link
              href="/login"
              className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeftIcon className="size-3.5" />
              {t("backToLogin")}
            </Link>
            <ContactSupportTrigger />
          </div>
        }
      />
    </div>
  )
}
