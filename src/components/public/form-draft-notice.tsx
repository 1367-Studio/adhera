"use client"

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"

// One muted line under the form's heading when useFormDraft restored the visitor's answers —
// tells them why the form is already filled, and offers a blank one instead.
export function FormDraftNotice({ onDiscard }: { onDiscard: () => void }) {
  const t = useTranslations("formDraft")
  return (
    <p className="text-sm text-muted-foreground">
      {t("restored")}{" "}
      <Button variant="link" size="sm" className="h-auto p-0" onClick={onDiscard}>
        {t("discard")}
      </Button>
    </p>
  )
}
