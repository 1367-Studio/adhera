"use client"

import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"

export type EvenementStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED"

const STATUS_VARIANT: Record<EvenementStatus, "secondary" | "default" | "outline"> = {
  DRAFT: "secondary", PUBLISHED: "default", ARCHIVED: "outline",
}

const STATUS_LABEL_KEY: Record<EvenementStatus, "draft" | "published" | "archived"> = {
  DRAFT: "draft", PUBLISHED: "published", ARCHIVED: "archived",
}

// One badge for an event's publication status — the events list, the event wizard and the
// bilan page all show it, so it must look the same everywhere.
export function EvenementStatusBadge({ status }: { status: EvenementStatus }) {
  const t = useTranslations("evenements.formStatus")
  return <Badge variant={STATUS_VARIANT[status]}>{t(STATUS_LABEL_KEY[status])}</Badge>
}
