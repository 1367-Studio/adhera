import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { TachesView } from "@/components/taches/taches-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taches.view")
  return { title: t("title") }
}

export default function TachesPage() {
  return <TachesView />
}
