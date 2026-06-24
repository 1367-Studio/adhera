import type { Metadata } from "next"
import { PortalLoginForm } from "@/components/auth/portal-login-form"

export const metadata: Metadata = { title: "Connexion — Espace membre" }

export default async function PortalLoginPage({
  params,
  searchParams,
}: {
  params:       Promise<{ slug: string }>
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const { slug }        = await params
  const { callbackUrl } = await searchParams

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-md bg-foreground" />
          <span className="text-base font-semibold">Adhéra</span>
        </div>

        <div className="rounded-xl border bg-card shadow-sm p-8 space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">Espace membre</h1>
            <p className="text-sm text-muted-foreground">
              Connectez-vous pour accéder à votre espace.
            </p>
          </div>

          <PortalLoginForm slug={slug} callbackUrl={callbackUrl} />
        </div>
      </div>
    </div>
  )
}
