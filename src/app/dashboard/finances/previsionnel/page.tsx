import { getTranslations } from "next-intl/server"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"

export default async function PrevisionnelPage() {
  const t  = await getTranslations("finances.nav")
  const tc = await getTranslations("finances.comingSoon")
  return (
    <div className="space-y-4">
      <PageHeader title={t("previsionnel")} />
      <EmptyState title={tc("title")} description={tc("description")} />
    </div>
  )
}
