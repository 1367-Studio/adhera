import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { PaperFormTemplateEditView } from "@/components/paper-form-templates/paper-form-template-edit-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("paperFormTemplates")
  return { title: t("title") }
}

export default async function PaperFormTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PaperFormTemplateEditView templateId={id} />
}
