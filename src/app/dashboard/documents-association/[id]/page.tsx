import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { AssociationDocumentEditView } from "@/components/association-documents/association-document-edit-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("associationDocuments")
  return { title: t("title") }
}

export default async function AssociationDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <AssociationDocumentEditView documentId={id} />
}
