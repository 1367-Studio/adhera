"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { FaqList } from "@/components/support/faq-list"

const POPUP_DELAY_MS = 10_000

export function FiscalPeriodPopup({ show }: { show: boolean }) {
  const t = useTranslations("fiscalPeriodPopup")
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [showFaq, setShowFaq] = useState(false)
  const guideUrl = t("guideUrl")
  const faqPreview = t.raw("faqPreview.items") as { question: string; answer: string }[]

  useEffect(() => {
    if (!show) return
    const timer = window.setTimeout(() => {
      setOpen(true)
      fetch("/api/me/fiscal-period-popup", { method: "PATCH" }).catch(() => {})
    }, POPUP_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [show])

  function handleConfigure() {
    setOpen(false)
    router.push("/dashboard/finances/exercices")
  }

  function handleViewFullFaq() {
    setOpen(false)
    router.push("/dashboard/suporte")
  }

  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t("title")}
      size="lg"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("later")}</Button>
          <Button type="button" onClick={handleConfigure}>{t("cta")}</Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p>{t("greeting")}</p>
        <p>{t("body")}</p>
        {guideUrl && (
          <p>
            <button type="button" className="text-primary underline" onClick={() => { setOpen(false); router.push(guideUrl) }}>
              {t("guideLinkLabel")}
            </button>
          </p>
        )}
        <p className="text-muted-foreground">{t("supportHint")}</p>
        <p className="text-muted-foreground">
          {t("thanks")}<br />{t("teamSignature")}
        </p>

        {showFaq ? (
          <div className="space-y-2">
            <FaqList items={faqPreview} />
            <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={handleViewFullFaq}>
              {t("viewFullFaq")}
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setShowFaq(true)}>
            {t("helpCta")}
          </Button>
        )}
      </div>
    </Modal>
  )
}
