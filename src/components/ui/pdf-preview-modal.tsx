"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { CircleNotchIcon, DownloadSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  pdfUrl: string
  title: string
}

// Fetches the PDF into a blob instead of pointing the iframe straight at `pdfUrl` so a
// failed request (expired session, generation error) surfaces as a real error state
// instead of the iframe silently rendering the browser's or an error page's blank shell.
export function PdfPreviewModal({ open, onOpenChange, pdfUrl, title }: Props) {
  const t = useTranslations("documents")
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let objectUrl: string | null = null
    setBlobUrl(null)
    setError(false)

    fetch(pdfUrl)
      .then(res => {
        if (!res.ok) throw new Error("PDF fetch failed")
        return res.blob()
      })
      .then(blob => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setBlobUrl(objectUrl)
      })
      .catch(() => { if (!cancelled) setError(true) })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [open, pdfUrl, attempt])

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} size="4xl">
      <div className="space-y-3">
        <div className="h-[75vh] w-full rounded-md border bg-white">
          {error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <WarningCircleIcon className="size-6 text-destructive" />
              <p>{t("previewLoadError")}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setAttempt(a => a + 1)}>
                {t("retry")}
              </Button>
            </div>
          ) : blobUrl ? (
            <iframe src={blobUrl} title={title} className="size-full rounded-md" />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <CircleNotchIcon className="size-4 animate-spin" />
              {t("loading")}
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={() => window.open(pdfUrl, "_blank")}>
            <DownloadSimpleIcon className="mr-1.5 size-3.5" />
            {t("download")}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
