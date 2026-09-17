import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { AssociationDocumentForm } from "@/components/association-documents/association-document-form"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("associationDocuments.form")
  return { title: t("newTitle") }
}

export default function NewAssociationDocumentPage() {
  return <AssociationDocumentForm />
}
