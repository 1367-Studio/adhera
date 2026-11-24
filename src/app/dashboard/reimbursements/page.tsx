import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { ReimbursementsView } from "@/components/reimbursements/reimbursements-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reimbursements.view")
  return { title: t("title") }
}

export default function ReimbursementsPage() {
  return <ReimbursementsView />
}
