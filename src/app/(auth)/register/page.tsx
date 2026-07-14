import type { Metadata } from "next"
import Link from "next/link"
import { RegisterForm } from "@/components/auth/register-form"
import { getPricingInfo } from "@/lib/stripe"
import { APP_NAME } from "@/config/brand"
import { LogoMark } from "@/components/layout/logo-mark"

export const metadata: Metadata = { title: "Créer un compte" }

export default async function RegisterPage() {
  const pricing = await getPricingInfo()

  return (
    <div className="w-full max-w-md">
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <LogoMark className="size-6" />
        <span className="text-base font-semibold">{APP_NAME}</span>
      </div>

      <div className="rounded-xl border bg-card shadow-sm p-8 space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Créer un compte</h1>
          <p className="text-sm text-muted-foreground">
            {pricing.trialDays} jours d'essai gratuit · Sans engagement · Annulation facile
          </p>
        </div>

        <RegisterForm pricing={pricing} />

        <p className="text-center text-sm text-muted-foreground">
          Déjà un compte ?{" "}
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80 transition-colors">
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  )
}
