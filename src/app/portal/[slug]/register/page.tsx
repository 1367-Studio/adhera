import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeftIcon, AsteriskIcon } from "@phosphor-icons/react/dist/ssr";
import { PortalRegisterForm } from "@/components/auth/portal-register-form"
import { APP_NAME } from "@/config/brand"

export const metadata: Metadata = { title: "Créer un compte — Espace membre" }

export default async function PortalRegisterPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2">
          <AsteriskIcon className="size-6" weight="bold" />
          <span className="text-base font-semibold">{APP_NAME}</span>
        </div>

        <div className="rounded-xl border bg-card shadow-sm p-8 space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">Créer un compte</h1>
            <p className="text-sm text-muted-foreground">
              Rejoignez l&apos;espace membre de votre association.
            </p>
          </div>

          <PortalRegisterForm slug={slug} />

          <Link
            href={`/portal/${slug}/login`}
            className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeftIcon className="size-3.5" />
            Déjà un compte ? Se connecter
          </Link>
        </div>
      </div>
    </div>
  )
}
