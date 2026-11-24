import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { LicencasView } from "@/components/licencas/licencas-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("licencas")
  return { title: t("title") }
}

export default function LicencasPage() {
  return <LicencasView />
}
