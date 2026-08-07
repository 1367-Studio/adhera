import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { DevisView } from "@/components/devis/devis-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("devis.view")
  return { title: t("title") }
}

export default function DevisPage() {
  return <DevisView />
}
