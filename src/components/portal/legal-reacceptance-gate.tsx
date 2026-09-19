"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr"
import { LegalConsent, type RequiredLegalDocument } from "@/components/public/legal-consent"
import { Button } from "@/components/ui/button"
import { BASE_PATH } from "@/lib/env"

// Stands in front of the whole member portal while the association has documents this member
// has not agreed to — either new ones, or ones whose wording changed since they last agreed.
//
// Deliberately the entire screen rather than a dismissible dialog: the point is that nothing
// else in the portal is reachable until they decide. The sign-out link is the one way past it,
// so nobody is trapped in a page they do not want to accept.
export function LegalReacceptanceGate(
  { slug, documents }: { slug: string; documents: RequiredLegalDocument[] },
) {
  const t      = useTranslations("legalConsent")
  const router = useRouter()

  const [accepted, setAccepted]   = useState(false)
  const [submitting, setSubmitting] = useState(false)

  async function handleAccept() {
    setSubmitting(true)
    try {
      const response = await fetch(`${BASE_PATH}/api/portal/legal/accept`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ acceptedLegalRevisionIds: documents.map(document => document.revisionId) }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error ?? t("gateError"))
      // The gate lives in a server layout, so the server has to re-evaluate what is pending.
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("gateError"))
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">{t("gateTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("gateSubtitle")}</p>
        </div>

        <LegalConsent
          slug={slug}
          documents={documents}
          checked={accepted}
          onChange={setAccepted}
          disabled={submitting}
        />

        <div className="flex items-center justify-between gap-4">
          <a
            href={`${BASE_PATH}/portal/${slug}/login`}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("gateSignOut")}
          </a>
          <Button onClick={handleAccept} disabled={!accepted || submitting}>
            {submitting && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
            {t("gateSubmit")}
          </Button>
        </div>
      </div>
    </div>
  )
}
