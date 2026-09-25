import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { PaperFormTemplatesView } from "@/components/paper-form-templates/paper-form-templates-view"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("paperFormTemplates")
  return { title: t("title") }
}

export default function PaperFormTemplatesPage() {
  return <PaperFormTemplatesView />
}
