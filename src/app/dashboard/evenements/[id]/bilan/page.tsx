import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { EvenementBilanView } from "@/components/evenements/evenement-bilan-view"

// Auth, module and dashboard-access guards come from the parent evenements layout, like the
// presences and avis pages next to this one.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("evenements.bilanPage")
  return { title: t("metaTitle") }
}

export default function EvenementBilanPage() {
  return <EvenementBilanView />
}
