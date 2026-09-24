"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { UploadSimpleIcon } from "@phosphor-icons/react/dist/ssr"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PAGE_RENDER_ACCEPT_ATTRIBUTE, type RenderedPageImage } from "@/lib/paper-form/render-pages.client"

type PagePreview = Pick<RenderedPageImage, "previewUrl" | "width" | "height">

// Small page images of the blank form, each opening the full-size page in a modal.
export function PaperFormPageThumbnails({ pages }: { pages: readonly PagePreview[] }) {
  const t = useTranslations("paperFormTemplates.editor")
  const [enlargedPageIndex, setEnlargedPageIndex] = useState<number | null>(null)
  const enlargedPage = enlargedPageIndex === null ? null : pages[enlargedPageIndex]

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        {pages.map((page, pageIndex) => (
          <li key={page.previewUrl}>
            <button
              type="button"
              onClick={() => setEnlargedPageIndex(pageIndex)}
              className="group block w-full space-y-1 text-left outline-none"
              aria-label={t("enlargePage", { page: pageIndex + 1 })}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, nothing for next/image to optimise */}
              <img
                src={page.previewUrl}
                alt=""
                width={page.width}
                height={page.height}
                className="h-auto w-full rounded-md border bg-white transition-colors group-hover:border-foreground/30 group-focus-visible:ring-3 group-focus-visible:ring-ring/50"
              />
              <span className="block text-xs text-muted-foreground">{t("pageLabel", { page: pageIndex + 1 })}</span>
            </button>
          </li>
        ))}
      </ul>

      <Modal
        open={enlargedPage !== null}
        onOpenChange={open => { if (!open) setEnlargedPageIndex(null) }}
        title={t("pageLabel", { page: (enlargedPageIndex ?? 0) + 1 })}
        size="4xl"
      >
        {enlargedPage && (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL
          <img
            src={enlargedPage.previewUrl}
            alt={t("pageLabel", { page: (enlargedPageIndex ?? 0) + 1 })}
            width={enlargedPage.width}
            height={enlargedPage.height}
            className="h-auto w-full rounded-md border bg-white"
          />
        )}
      </Modal>
    </>
  )
}

// Drop zone / picker for the blank form: one PDF, or one photo per page.
export function BlankFormDropZone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const t = useTranslations("paperFormTemplates.editor")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  function handleFileList(fileList: FileList | null) {
    const files = fileList ? Array.from(fileList) : []
    if (files.length > 0) onFiles(files)
  }

  return (
    <div
      onDragOver={event => { event.preventDefault(); if (!disabled) setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={event => {
        event.preventDefault()
        setIsDragOver(false)
        if (!disabled) handleFileList(event.dataTransfer.files)
      }}
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center transition-colors",
        isDragOver && "border-foreground/40 bg-muted/40",
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={PAGE_RENDER_ACCEPT_ATTRIBUTE}
        multiple
        className="hidden"
        onChange={event => { handleFileList(event.target.files); event.target.value = "" }}
      />
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("dropTitle")}</p>
        <p className="text-xs text-muted-foreground">{t("dropHint")}</p>
      </div>
      <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={disabled}>
        <UploadSimpleIcon className="size-4" />
        {t("chooseFile")}
      </Button>
    </div>
  )
}
