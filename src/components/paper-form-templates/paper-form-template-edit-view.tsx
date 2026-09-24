"use client"

import { useTranslations } from "next-intl"
import { usePaperFormTemplate } from "@/hooks/use-paper-form-templates"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { PaperFormTemplateEditor } from "./paper-form-template-editor"
import { PAPER_FORM_TEMPLATES_PATH } from "./paper-form-templates-view"

export function PaperFormTemplateEditView({ templateId }: { templateId: string }) {
  const t = useTranslations("paperFormTemplates")
  // No refetch on window focus: coming back to the tab must never swap the mapping under
  // unsaved edits. Saves refresh the cache through the mutation's invalidation.
  const { data: template, isLoading } = usePaperFormTemplate(templateId, { refetchOnWindowFocus: false })

  if (isLoading) return <DetailLoadingSkeleton />
  if (!template) {
    return <DetailNotFound message={t("notFound")} backHref={PAPER_FORM_TEMPLATES_PATH} backLabel={t("backToList")} />
  }

  return <PaperFormTemplateEditor key={template.id} template={template} />
}
