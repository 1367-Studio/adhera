import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { MaterielView } from "@/components/materiel/materiel-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("materiel.view")
  return { title: t("title") }
}

export default function MaterielPage() {
  return <MaterielView />
}
