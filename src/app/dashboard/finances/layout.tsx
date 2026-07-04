import type { Metadata } from "next"
import { requireModule } from "@/lib/auth/require-module"
import { FinancesNav } from "@/components/finances/finances-nav"

export const metadata: Metadata = { title: "Finances" }

export default async function FinancesLayout({ children }: { children: React.ReactNode }) {
  await requireModule("finances")
  return (
    <div className="space-y-4">
      <FinancesNav />
      {children}
    </div>
  )
}
