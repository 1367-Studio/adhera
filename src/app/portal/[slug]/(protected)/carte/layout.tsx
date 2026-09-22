import { requireModule } from "@/lib/auth/require-module"

// Same gate as the cotisation section it belongs to: the card proves a cotisation was paid,
// so an association that doesn't run cotisations has no card either.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireModule("cotisations")
  return <>{children}</>
}
