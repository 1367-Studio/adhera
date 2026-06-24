import type { Metadata } from "next"
import Link from "next/link"
import { LoginForm } from "@/components/layout/login-form"

export const metadata: Metadata = { title: "Connexion" }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams

  return (
    <div className="w-full max-w-sm">
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <div className="size-6 rounded-md bg-foreground" />
        <span className="text-base font-semibold">Adhéra</span>
      </div>

      <div className="rounded-xl border bg-card shadow-sm p-8 space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Connexion</h1>
          <p className="text-sm text-muted-foreground">
            Entrez vos identifiants pour accéder à votre espace.
          </p>
        </div>

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
