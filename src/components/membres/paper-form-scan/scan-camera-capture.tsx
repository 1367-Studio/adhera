"use client"

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { ArrowCounterClockwiseIcon, CameraIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { ImageThumbnail } from "@/components/ui/image-thumbnail"
import type { CapturedSlot, ScanPage } from "./scan-model"

// Camera shots only: the formats renderFileToPageImages reads, plus image/* so every phone
// opens its camera (iOS converts to JPEG; an unreadable format fails with the usual toast).
const CAMERA_CAPTURE_ACCEPT_ATTRIBUTE = "image/jpeg,image/png,image/*"

// ─── Capture state ───────────────────────────────────────────────────────────────────────
//
// Guided capture: the app says « Fiche 2 — page 1 sur 2 », the manager shoots, and the photo
// is tagged with that slot. Two numbers per fiche:
//   - formNumber (internal, in CapturedSlot): only ever increases and is never reused, so a
//     new fiche can never merge with the pages of an older one in groupPagesIntoForms.
//   - displayNumber (what the manager reads): the fiche's position among the photographed
//     fiches, so removing « Fiche 2 » renumbers the next ones.
// Everything is derived from `pages` (a captured page carries its slot); only what the pages
// cannot say is kept here: the fiche being filled, the fiches closed early and the last shot.

type CaptureTarget = {
  capturedSlot:   CapturedSlot
  // Retake: the page the new photo replaces, removed once the photo is chosen.
  replacedPageId: string | null
}

type PendingShot = {
  capturedSlot: CapturedSlot
  fileName:     string
}

// "complete" = every page of the template; "inProgress" = the fiche being filled; "missing"
// = a fiche left behind (skipped or removed from) with pages still lacking.
export type CapturedFormState = "complete" | "inProgress" | "missing"

export type CapturedFormSummary = {
  formNumber:         number
  displayNumber:      number
  pageIds:            string[]
  pageNumbers:        number[]
  missingPageNumbers: number[]
  state:              CapturedFormState
}

type UseCameraCaptureOptions = {
  pages:              ScanPage[]
  // Pages per form of the chosen template; null while no template is chosen.
  pagesPerForm:       number | null
  onAddCapturedPhoto: (file: File, capturedSlot: CapturedSlot) => Promise<void>
  onRemovePage:       (pageId: string) => void
}

function pageNumbersUpTo(pagesPerForm: number): number[] {
  return Array.from({ length: pagesPerForm }, (_unused, pageIndex) => pageIndex + 1)
}

function isSameSlot(firstSlot: CapturedSlot, secondSlot: CapturedSlot): boolean {
  return firstSlot.formNumber === secondSlot.formNumber && firstSlot.pageNumber === secondSlot.pageNumber
}

export function useCameraCapture({ pages, pagesPerForm, onAddCapturedPhoto, onRemovePage }: UseCameraCaptureOptions) {
  const [activeFormNumber, setActiveFormNumber]   = useState<number | null>(null)
  const [closedFormNumbers, setClosedFormNumbers] = useState<Set<number>>(new Set())
  const [lastShotSlot, setLastShotSlot]           = useState<CapturedSlot | null>(null)
  const [pendingShot, setPendingShot]             = useState<PendingShot | null>(null)
  // One camera input for every shot: this records what the next photo is for.
  const captureTargetRef = useRef<CaptureTarget | null>(null)

  // Captured pages by internal fiche number, in capture order within each fiche.
  const capturedPagesByFormNumber = new Map<number, ScanPage[]>()
  for (const page of [...pages].sort((first, second) => first.uploadIndex - second.uploadIndex)) {
    if (!page.capturedSlot) continue
    const formPages = capturedPagesByFormNumber.get(page.capturedSlot.formNumber) ?? []
    formPages.push(page)
    capturedPagesByFormNumber.set(page.capturedSlot.formNumber, formPages)
  }
  const capturedFormNumbers = [...capturedPagesByFormNumber.keys()].sort((first, second) => first - second)

  // A photo still being prepared already holds its slot: the prompt must not move back to
  // it (retake) nor ask for it twice.
  const occupiedPageNumbersOf = (formNumber: number): number[] => {
    const pageNumbers = new Set((capturedPagesByFormNumber.get(formNumber) ?? []).map((page) => page.capturedSlot?.pageNumber ?? 0))
    if (pendingShot?.capturedSlot.formNumber === formNumber) pageNumbers.add(pendingShot.capturedSlot.pageNumber)
    return [...pageNumbers].sort((first, second) => first - second)
  }

  const missingPageNumbersOf = (formNumber: number): number[] => {
    if (pagesPerForm === null) return []
    const occupiedPageNumbers = occupiedPageNumbersOf(formNumber)
    return pageNumbersUpTo(pagesPerForm).filter((pageNumber) => !occupiedPageNumbers.includes(pageNumber))
  }

  // The fiche being filled, or a brand-new number once it is complete or closed.
  const highestFormNumber = Math.max(activeFormNumber ?? 0, pendingShot?.capturedSlot.formNumber ?? 0, ...capturedFormNumbers)
  const activeFormIsOpen  =
    activeFormNumber !== null && !closedFormNumbers.has(activeFormNumber) && missingPageNumbersOf(activeFormNumber).length > 0
  const currentFormNumber = activeFormIsOpen && activeFormNumber !== null ? activeFormNumber : highestFormNumber + 1
  const nextPageNumber    = missingPageNumbersOf(currentFormNumber)[0] ?? 1

  const capturedForms: CapturedFormSummary[] = capturedFormNumbers.map((formNumber, formIndex) => {
    const missingPageNumbers = missingPageNumbersOf(formNumber)
    return {
      formNumber,
      displayNumber: formIndex + 1,
      pageIds:       (capturedPagesByFormNumber.get(formNumber) ?? []).map((page) => page.pageId),
      pageNumbers:   occupiedPageNumbersOf(formNumber),
      missingPageNumbers,
      state:
        missingPageNumbers.length === 0 ? "complete" :
        formNumber === currentFormNumber ? "inProgress" :
        "missing",
    }
  })

  const displayNumberOf = (formNumber: number): number => {
    const formIndex = capturedFormNumbers.indexOf(formNumber)
    return formIndex >= 0 ? formIndex + 1 : capturedFormNumbers.length + 1
  }

  const currentDisplayNumber = displayNumberOf(currentFormNumber)
  const currentFormHasPages  = capturedPagesByFormNumber.has(currentFormNumber)
  // Skipping only makes sense for a started fiche that still lacks a page.
  const canSkip = pagesPerForm !== null && pagesPerForm > 1 && currentFormHasPages && pendingShot === null

  // Latest page for the last shot's slot (a retake replaces it).
  const lastShotPage = lastShotSlot
    ? [...(capturedPagesByFormNumber.get(lastShotSlot.formNumber) ?? [])].reverse()
        .find((page) => page.capturedSlot !== null && isSameSlot(page.capturedSlot, lastShotSlot)) ?? null
    : null

  function openCamera(cameraInput: HTMLInputElement | null, captureTarget: CaptureTarget) {
    captureTargetRef.current = captureTarget
    cameraInput?.click()
  }

  function targetForNextPage(): CaptureTarget {
    return { capturedSlot: { formNumber: currentFormNumber, pageNumber: nextPageNumber }, replacedPageId: null }
  }

  function targetForRetake(): CaptureTarget | null {
    if (!lastShotSlot || !lastShotPage) return null
    return { capturedSlot: lastShotSlot, replacedPageId: lastShotPage.pageId }
  }

  async function capturePhoto(capturedFile: File, photoFileName: (slot: CapturedSlot, fileExtension: string) => string) {
    const captureTarget = captureTargetRef.current
    captureTargetRef.current = null
    if (!captureTarget || pendingShot !== null) return
    const { capturedSlot, replacedPageId } = captureTarget

    // Phone cameras often name every shot "image.jpg": the slot name keeps each photo
    // recognisable (it becomes the page's sourceName in the review).
    const fileExtension = capturedFile.type === "image/png" ? "png" : "jpg"
    const namedPhoto    = new File([capturedFile], photoFileName(capturedSlot, fileExtension), {
      type:         capturedFile.type,
      lastModified: capturedFile.lastModified,
    })

    if (replacedPageId) onRemovePage(replacedPageId)
    else setActiveFormNumber(capturedSlot.formNumber)
    setLastShotSlot(capturedSlot)
    setPendingShot({ capturedSlot, fileName: namedPhoto.name })
    // Resolves once the photo is rendered — or failed, with the wizard's usual toast, in which
    // case the slot simply stays empty and the prompt asks for it again.
    await onAddCapturedPhoto(namedPhoto, capturedSlot)
    setPendingShot(null)
  }

  function skipToNextForm() {
    if (!canSkip) return
    setClosedFormNumbers((currentNumbers) => new Set(currentNumbers).add(currentFormNumber))
  }

  // Closed as well, so its number is never handed out again even with no page left.
  function removeCapturedForm(capturedForm: CapturedFormSummary) {
    if (pendingShot !== null) return
    for (const pageId of capturedForm.pageIds) onRemovePage(pageId)
    setClosedFormNumbers((currentNumbers) => new Set(currentNumbers).add(capturedForm.formNumber))
  }

  return {
    pagesPerForm,
    capturedForms,
    currentDisplayNumber,
    nextPageNumber,
    canSkip,
    isPreparing:     pendingShot !== null,
    pendingFileName: pendingShot?.fileName ?? null,
    lastShotSlot:    pendingShot !== null || lastShotPage !== null ? lastShotSlot : null,
    lastShotPage,
    displayNumberOf,
    openCamera,
    targetForNextPage,
    targetForRetake,
    capturePhoto,
    skipToNextForm,
    removeCapturedForm,
  }
}

export type CameraCapture = ReturnType<typeof useCameraCapture>

// ─── Capture block ───────────────────────────────────────────────────────────────────────

type ScanCameraCaptureProps = {
  camera: CameraCapture
}

// Touch devices only (coarse pointer): desktop keeps the drop zone alone.
export function ScanCameraCapture({ camera }: ScanCameraCaptureProps) {
  const t = useTranslations("paperFormScan.upload.camera")
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const { pagesPerForm, currentDisplayNumber, nextPageNumber, lastShotSlot, lastShotPage, isPreparing } = camera
  const isSinglePage = pagesPerForm === 1

  function handleCameraChange(event: React.ChangeEvent<HTMLInputElement>) {
    const capturedFile = event.target.files?.[0]
    // Reset so the next shot fires onChange again, even for an identical file.
    event.target.value = ""
    if (!capturedFile) return
    void camera.capturePhoto(capturedFile, (capturedSlot, fileExtension) => t("photoFileName", {
      form:      camera.displayNumberOf(capturedSlot.formNumber),
      page:      capturedSlot.pageNumber,
      extension: fileExtension,
    }))
  }

  function handleRetake() {
    const retakeTarget = camera.targetForRetake()
    if (retakeTarget) camera.openCamera(cameraInputRef.current, retakeTarget)
  }

  const lastShotDisplayNumber = lastShotSlot ? camera.displayNumberOf(lastShotSlot.formNumber) : 0

  return (
    <section aria-labelledby="paper-form-scan-camera-title" className="hidden flex-col gap-3 pointer-coarse:flex">
      <input
        ref={cameraInputRef}
        type="file"
        accept={CAMERA_CAPTURE_ACCEPT_ATTRIBUTE}
        capture="environment"
        className="hidden"
        onChange={handleCameraChange}
      />
      <h3 id="paper-form-scan-camera-title" className="text-sm font-medium">{t("title")}</h3>

      {pagesPerForm === null ? (
        <p id="paper-form-scan-camera-needs-template" className="text-sm text-muted-foreground">{t("needsTemplate")}</p>
      ) : (
        <p role="status" aria-live="polite" className="text-base font-semibold">
          {isSinglePage
            ? t("promptSinglePage", { form: currentDisplayNumber })
            : t("prompt", { form: currentDisplayNumber, page: nextPageNumber, pages: pagesPerForm })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          className="flex-1 sm:flex-none"
          disabled={pagesPerForm === null}
          loading={isPreparing}
          aria-describedby={pagesPerForm === null ? "paper-form-scan-camera-needs-template" : undefined}
          onClick={() => camera.openCamera(cameraInputRef.current, camera.targetForNextPage())}
        >
          <CameraIcon className="size-4" />
          {pagesPerForm === null || isSinglePage ? t("captureForm") : t("capturePage", { page: nextPageNumber })}
        </Button>
        {camera.canSkip && (
          <Button variant="ghost" onClick={camera.skipToNextForm}>
            {t("skipToNextForm", { form: currentDisplayNumber + 1 })}
          </Button>
        )}
      </div>

      {lastShotSlot && (
        <div className="flex items-center gap-3">
          {lastShotPage && !isPreparing ? (
            <ImageThumbnail
              src={lastShotPage.previewUrl}
              alt={t("lastShotAlt", { form: lastShotDisplayNumber, page: lastShotSlot.pageNumber })}
            />
          ) : (
            <div className="size-10 shrink-0 rounded-md bg-muted" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              {isSinglePage
                ? t("lastShotSinglePage", { form: lastShotDisplayNumber })
                : t("lastShot", { form: lastShotDisplayNumber, page: lastShotSlot.pageNumber })}
            </p>
            {isPreparing && <p role="status" className="text-xs text-muted-foreground">{t("preparing")}</p>}
          </div>
          <Button
            size="sm"
            variant="ghost"
            disabled={isPreparing || !lastShotPage}
            aria-label={t("retakeLabel", { form: lastShotDisplayNumber, page: lastShotSlot.pageNumber })}
            onClick={handleRetake}
          >
            <ArrowCounterClockwiseIcon />
            {t("retake")}
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t("framingHint")}</p>
    </section>
  )
}
