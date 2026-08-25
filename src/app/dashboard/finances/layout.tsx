import type { Metadata } from "next"
import { requireModule } from "@/lib/auth/require-module"
import { FinancesBreadcrumb } from "@/components/finances/finances-breadcrumb"

export const metadata: Metadata = { title: "Finances" }

export default async function FinancesLayout({ children }: { children: React.ReactNode }) {
  await requireModule("finances")
  return (
    <div className="space-y-4">
      <FinancesBreadcrumb />
      {children}
    </div>
  )
}
