import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { GruposView } from "@/components/grupos/grupos-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("groupes.view")
  return { title: t("title") }
}

export default function GroupesPage() {
  return <GruposView />
}
