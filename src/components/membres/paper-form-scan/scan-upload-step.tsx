"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { CameraIcon, UploadSimpleIcon, XIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { SelectField } from "@/components/ui/select-field"
import { PAGE_RENDER_ACCEPT_ATTRIBUTE } from "@/lib/paper-form/render-pages.client"
import type { PaperFormTemplateResponse } from "@/lib/schemas/paper-form"

export const PAPER_FORM_TEMPLATES_PATH    = "/dashboard/membres/fiches-papier"
const NEW_PAPER_FORM_TEMPLATE_PATH = "/dashboard/membres/fiches-papier/nouveau"
// Camera shots only: the formats renderFileToPageImages reads, plus image/* so every phone
// opens its camera (iOS converts to JPEG; an unreadable format fails with the usual toast).
const CAMERA_CAPTURE_ACCEPT_ATTRIBUTE = "image/jpeg,image/png,image/*"

export type UploadedScanFile = {
  fileId:    string
  name:      string
  pageCount: number
}

type ScanUploadStepProps = {
  templates:          PaperFormTemplateResponse[]
  templateId:         string
  onTemplateChange:   (templateId: string) => void
  files:              UploadedScanFile[]
  preparingFileName:  string | null
  onAddFiles:         (files: File[]) => void
  onRemoveFile:       (fileId: string) => void
  onStart:            () => void
}

export function ScanUploadStep({
  templates, templateId, onTemplateChange, files, preparingFileName, onAddFiles, onRemoveFile, onStart,
}: ScanUploadStepProps) {
  const t = useTranslations("paperFormScan.upload")
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [capturedPhotoCount, setCapturedPhotoCount] = useState(0)

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

  const selectedTemplate = templates.find((template) => template.id === templateId)
  const totalPageCount   = files.reduce((pageTotal, file) => pageTotal + file.pageCount, 0)
  const expectedForms    = selectedTemplate ? Math.ceil(totalPageCount / selectedTemplate.pagesPerForm) : 0

  function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    const droppedFiles = Array.from(event.dataTransfer.files)
    if (droppedFiles.length > 0) onAddFiles(droppedFiles)
  }

  function handleCameraCapture(event: React.ChangeEvent<HTMLInputElement>) {
    const capturedFile = event.target.files?.[0]
    // Reset so the next shot fires onChange again, even for an identical file.
    event.target.value = ""
    if (!capturedFile) return
    const photoNumber = capturedPhotoCount + 1
    setCapturedPhotoCount(photoNumber)
    // Phone cameras often name every shot "image.jpg": a numbered name keeps each row of
    // the list recognisable. Each shot is added on its own, so the wizard renders them in
    // capture order (its name sort only orders files handed over together).
    const fileExtension = capturedFile.type === "image/png" ? "png" : "jpg"
    const numberedPhoto = new File(
      [capturedFile],
      t("photoFileName", { number: photoNumber, extension: fileExtension }),
      { type: capturedFile.type, lastModified: capturedFile.lastModified },
    )
    onAddFiles([numberedPhoto])
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

      <div
        role="button"
        tabIndex={0}
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fileInputRef.current?.click() } }}
        className="cursor-pointer rounded-lg border-2 border-dashed border-muted-foreground/30 p-10 text-center transition-colors hover:border-muted-foreground/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
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
        <p className="font-medium">{t("dropTitle")}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t("dropSubtitle")}</p>
        <p className="mt-3 text-xs text-muted-foreground">{t("privacyNote")}</p>
      </div>

      {/* Touch devices only (coarse pointer): desktop keeps the drop zone alone. */}
      <div className="hidden flex-col items-start gap-1.5 pointer-coarse:flex">
        <input
          ref={cameraInputRef}
          type="file"
          accept={CAMERA_CAPTURE_ACCEPT_ATTRIBUTE}
          capture="environment"
          className="hidden"
          onChange={handleCameraCapture}
        />
        <Button variant="outline" onClick={() => cameraInputRef.current?.click()}>
          <CameraIcon className="size-4" />
          {capturedPhotoCount > 0 ? t("nextPhoto") : t("takePhoto")}
        </Button>
        {capturedPhotoCount > 0 && (
          <p className="text-sm text-muted-foreground" role="status">{t("capturedPhotoCount", { count: capturedPhotoCount })}</p>
        )}
        <p className="text-xs text-muted-foreground">{t("cameraFramingHint")}</p>
      </div>

      {(files.length > 0 || preparingFileName) && (
        <div className="space-y-2">
          <ul className="divide-y rounded-lg border text-sm">
            {files.map((file) => (
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
            {preparingFileName && (
              <li className="flex items-center justify-between gap-3 px-3 py-1.5 text-muted-foreground" role="status">
                <span className="truncate">{preparingFileName}</span>
                {/* h-8 = the remove button of the rows above, so every row keeps the same height. */}
                <span className="flex h-8 shrink-0 items-center">{t("preparing")}</span>
              </li>
            )}
          </ul>
          {totalPageCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {selectedTemplate
                ? t("batchSummary", { pages: totalPageCount, forms: expectedForms })
                : t("pageTotal", { count: totalPageCount })}
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onStart} disabled={!selectedTemplate || totalPageCount === 0 || !!preparingFileName}>
          {t("start", { count: totalPageCount })}
        </Button>
      </div>
    </div>
  )
}
