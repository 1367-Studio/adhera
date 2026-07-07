import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata: Metadata = { title: "Mot de passe oublié" }

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const { callbackUrl } = await searchParams
  const backHref = callbackUrl ?? "/login"

  return (
    <div className="w-full max-w-sm">
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <div className="size-6 rounded-md bg-foreground" />
        <span className="text-base font-semibold">Adhéra</span>
      </div>

      <div className="rounded-xl border bg-card shadow-sm p-8 space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Mot de passe oublié ?</h1>
          <p className="text-sm text-muted-foreground">
            Entrez votre adresse email pour recevoir un lien de réinitialisation.
          </p>
        </div>

        <ForgotPasswordForm />

        <Link
          href={backHref}
          className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-3.5" />
          Retour à la connexion
        </Link>
      </div>
    </div>
  )
}
