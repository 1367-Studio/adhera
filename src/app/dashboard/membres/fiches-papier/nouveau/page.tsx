import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { PaperFormTemplateEditor } from "@/components/paper-form-templates/paper-form-template-editor"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("paperFormTemplates.editor")
  return { title: t("newTitle") }
}

export default function NewPaperFormTemplatePage() {
  return <PaperFormTemplateEditor />
}
