import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { FournisseursView } from "@/components/fournisseurs/fournisseurs-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("fournisseurs.view")
  return { title: t("title") }
}

export default function FournisseursPage() {
  return <FournisseursView />
}
