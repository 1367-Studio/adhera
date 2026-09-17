import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { AssociationDocumentsView } from "@/components/association-documents/association-documents-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("associationDocuments")
  return { title: t("title") }
}

export default function AssociationDocumentsPage() {
  return <AssociationDocumentsView />
}
