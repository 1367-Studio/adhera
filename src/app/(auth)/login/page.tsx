import type { Metadata } from "next"
import Link from "next/link"
import { AsteriskIcon } from "@phosphor-icons/react/dist/ssr"
import { LoginForm } from "@/components/layout/login-form"
import { APP_NAME } from "@/config/brand"

export const metadata: Metadata = { title: "Connexion" }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; suspended?: string }> }) {
  const { callbackUrl, suspended } = await searchParams

  return (
    <div className="w-full max-w-sm">
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <AsteriskIcon className="size-6" weight="bold" />
        <span className="text-base font-semibold">{APP_NAME}</span>
      </div>

      <div className="rounded-xl border bg-card shadow-sm p-8 space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Connexion</h1>
          <p className="text-sm text-muted-foreground">
            Entrez vos identifiants pour accéder à votre espace.
          </p>
        </div>

        {suspended && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            L&apos;abonnement de votre association est suspendu. Contactez votre administrateur pour régulariser la situation.
          </p>
        )}

        <LoginForm callbackUrl={callbackUrl} />

        <p className="text-center text-sm text-muted-foreground">
          Pas encore de compte ?{" "}
          <Link href="/register" className="font-medium text-foreground underline underline-offset-4 hover:text-foreground/80 transition-colors">
            Créer un compte
          </Link>
        </p>
      </div>
    </div>
  )
}
