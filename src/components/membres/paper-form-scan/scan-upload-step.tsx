"use client"

import { useRef } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { UploadSimpleIcon, XIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { SelectField } from "@/components/ui/select-field"
import { PAGE_RENDER_ACCEPT_ATTRIBUTE } from "@/lib/paper-form/render-pages.client"
import type { PaperFormTemplateResponse } from "@/lib/schemas/paper-form"
import { ScanCameraCapture, useCameraCapture, type CapturedFormSummary } from "./scan-camera-capture"
import type { CapturedSlot, ScanPage } from "./scan-model"

export const PAPER_FORM_TEMPLATES_PATH    = "/dashboard/membres/fiches-papier"
const NEW_PAPER_FORM_TEMPLATE_PATH = "/dashboard/membres/fiches-papier/nouveau"

export type UploadedScanFile = {
  fileId:    string
  name:      string
  pageCount: number
  // Slot the photo was taken for on the capture screen; null for an uploaded file.
  capturedSlot: CapturedSlot | null
}

type ScanUploadStepProps = {
  templates:          PaperFormTemplateResponse[]
  templateId:         string
  onTemplateChange:   (templateId: string) => void
  files:              UploadedScanFile[]
  preparingFileName:  string | null
  onAddFiles:         (files: File[]) => void
  onRemoveFile:       (fileId: string) => void
  // Capture screen: every page added so far (a captured one carries its capturedSlot), one
  // photo to add for a slot (resolves once rendered), and one page to remove (retake =
  // remove, then capture again).
  pages:              ScanPage[]
  onAddCapturedPhoto: (file: File, capturedSlot: CapturedSlot) => Promise<void>
  onRemovePage:       (pageId: string) => void
  onStart:            () => void
}

export function ScanUploadStep({
  templates, templateId, onTemplateChange, files, preparingFileName, onAddFiles, onRemoveFile,
  pages, onAddCapturedPhoto, onRemovePage, onStart,
}: ScanUploadStepProps) {
  const t = useTranslations("paperFormScan.upload")
  const fileInputRef     = useRef<HTMLInputElement>(null)
  const selectedTemplate = templates.find((template) => template.id === templateId)
  const camera = useCameraCapture({
    pages,
    pagesPerForm: selectedTemplate?.pagesPerForm ?? null,
    onAddCapturedPhoto,
    onRemovePage,
  })

  if (templates.length === 0) {
    return (
      <EmptyState
        title={t("noTemplateTitle")}
        description={t("noTemplateDescription")}
        action={
          <Button size="sm" variant="outline" nativeButton={false} render={<Link href={NEW_PAPER_FORM_TEMPLATE_PATH} />}>
            {t("createTemplate")}
          </Button>
        }
      />
    )
  }

  const totalPageCount   = files.reduce((pageTotal, file) => pageTotal + file.pageCount, 0)
  const expectedForms    = selectedTemplate ? Math.ceil(totalPageCount / selectedTemplate.pagesPerForm) : 0
  // Guided photos are listed one row per fiche, not one row per photo file.
  const uploadedFiles    = files.filter((file) => file.capturedSlot === null)
  const capturedForms    = camera.capturedForms
  const onlyCaptured     = files.length > 0 && uploadedFiles.length === 0
  // A guided photo shows its preparation on the capture block's last-shot row instead.
  const showPreparingRow = preparingFileName !== null && preparingFileName !== camera.pendingFileName

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    const droppedFiles = Array.from(event.dataTransfer.files)
    if (droppedFiles.length > 0) onAddFiles(droppedFiles)
  }

  // « Pages 1, 2 · page 3 absente »: nothing for a one-page template, where a fiche is one photo.
  function capturedPagesText(capturedForm: CapturedFormSummary): string {
    if (selectedTemplate?.pagesPerForm === 1) return ""
    const pagesText = t("capturedPages", { count: capturedForm.pageNumbers.length, list: capturedForm.pageNumbers.join(", ") })
    if (capturedForm.state === "complete")   return pagesText
    if (capturedForm.state === "inProgress") return `${pagesText} · ${t("capturedInProgress")}`
    const missingText = t("capturedMissing", {
      count: capturedForm.missingPageNumbers.length,
      list:  capturedForm.missingPageNumbers.join(", "),
    })
    return `${pagesText} · ${missingText}`
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <SelectField
            id="paper-form-scan-template"
            label={t("template")}
            options={templates.map((template) => ({ value: template.id, label: template.name }))}
            value={templateId}
            onValueChange={onTemplateChange}
            placeholder={t("templatePlaceholder")}
          />
          <p className="text-xs text-muted-foreground">
            {selectedTemplate
              ? t("templateSummary", { pages: selectedTemplate.pagesPerForm, fields: selectedTemplate.fields.length })
              : null}{" "}
            <Link href={PAPER_FORM_TEMPLATES_PATH} className="underline-offset-4 hover:text-foreground hover:underline">
              {t("manageTemplates")}
            </Link>
          </p>
          {selectedTemplate?.identificationText && (
            <p className="text-xs text-muted-foreground">{t("strictTemplateNotice", { name: selectedTemplate.name })}</p>
          )}
        </div>
      </div>

      {/* Rendered before the drop zone so a phone reads template → camera → gallery; hidden on
          desktop, whose layout is unchanged. */}
      <ScanCameraCapture camera={camera} />

      <div
        role="button"
        tabIndex={0}
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInputRef.current?.click() } }}
        className="cursor-pointer rounded-lg border-2 border-dashed border-muted-foreground/30 p-10 text-center pointer-coarse:p-6 transition-colors hover:border-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={PAGE_RENDER_ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(event) => {
            const selectedFiles = Array.from(event.target.files ?? [])
            event.target.value = ""
            if (selectedFiles.length > 0) onAddFiles(selectedFiles)
          }}
        />
        <UploadSimpleIcon className="mx-auto mb-3 size-8 text-muted-foreground" />
        <p className="font-medium">
          <span className="pointer-coarse:hidden">{t("dropTitle")}</span>
          <span className="hidden pointer-coarse:inline">{t("galleryTitle")}</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{t("dropSubtitle")}</p>
        <p className="mt-3 text-xs text-muted-foreground">{t("privacyNote")}</p>
      </div>

      {(uploadedFiles.length > 0 || capturedForms.length > 0 || showPreparingRow) && (
        <div className="space-y-2">
          <ul className="divide-y rounded-lg border text-sm" aria-label={onlyCaptured ? t("capturedListLabel") : undefined}>
            {uploadedFiles.map((file) => (
              <li key={file.fileId} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="truncate">{file.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {t("pageCount", { count: file.pageCount })}
                  <Button size="icon-sm" variant="ghost" aria-label={t("removeFile", { name: file.name })} onClick={() => onRemoveFile(file.fileId)}>
                    <XIcon />
                  </Button>
                </span>
              </li>
            ))}
            {capturedForms.map((capturedForm) => (
              <li key={capturedForm.formNumber} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className="truncate">{t("capturedForm", { form: capturedForm.displayNumber })}</span>
                <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                  {capturedPagesText(capturedForm)}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("removeCapturedForm", { form: capturedForm.displayNumber })}
                    disabled={camera.isPreparing}
                    onClick={() => camera.removeCapturedForm(capturedForm)}
                  >
                    <XIcon />
                  </Button>
                </span>
              </li>
            ))}
            {showPreparingRow && (
              <li className="flex items-center justify-between gap-3 px-3 py-1.5 text-muted-foreground" role="status">
                <span className="truncate">{preparingFileName}</span>
                {/* h-8 = the remove button of the rows above, so every row keeps the same height. */}
                <span className="flex h-8 shrink-0 items-center">{t("preparing")}</span>
              </li>
            )}
          </ul>
          {totalPageCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {onlyCaptured
                ? t("capturedSummary", { forms: capturedForms.length, pages: totalPageCount })
                : selectedTemplate
                  ? t("batchSummary", { pages: totalPageCount, forms: expectedForms })
                  : t("pageTotal", { count: totalPageCount })}
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onStart} disabled={!selectedTemplate || totalPageCount === 0 || !!preparingFileName || camera.isPreparing}>
          {t("start", { count: totalPageCount })}
        </Button>
      </div>
    </div>
  )
}
