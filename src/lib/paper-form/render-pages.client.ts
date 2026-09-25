// Browser-only: turns an uploaded paper form (PDF, or a JPEG/PNG photo of one page) into
// the JPEG page images the paper-form routes accept (POST /api/membres/paper-forms/analyze,
// POST /api/membres/scan/extract). Nothing is uploaded from here — the caller sends the
// base64 it gets back.
//
// Shared by the template editor (blank form → analyze, every page in ONE request) and the
// scan screen (filled forms → extract, ONE page per request); the byte budgets below are
// the part that differs between the two, see PageRenderOptions.

import { MAX_FUNCTION_UPLOAD_BYTES } from "@/lib/upload-limits"
import type { PaperFormImageMediaType } from "@/lib/paper-form-targets"

// ─── Public types ────────────────────────────────────────────────────────────────────────

export type RenderedPageImage = {
  // Raw base64 of the JPEG, no "data:…;base64," prefix — ready for paperFormPageImageSchema.
  base64:     string
  mediaType:  PaperFormImageMediaType
  width:      number
  height:     number
  // Object URL of the same JPEG, for <img> previews. Owned by the caller: release it with
  // releasePageImages() once the previews are gone, or it leaks until the tab closes.
  previewUrl: string
}

export type PageRenderOptions = {
  // Target width of each rendered page. A PDF page is rendered at the scale giving this
  // width; a photo is only ever scaled DOWN to it. Default 1600 px — enough for handwriting.
  maxWidth?:     number
  // Starting JPEG quality (0–1), lowered automatically when a page is over budget. Default 0.8.
  jpegQuality?:  number
  // Hard ceiling for one encoded page, in bytes. Default 900 KB.
  maxPageBytes?: number
  // Ceiling for all pages together, in encoded bytes — set it when every page goes in ONE
  // request (analyze). Each page is then held to maxTotalBytes / pageCount. Leave it out
  // when pages are sent one by one (extract). Use PAGE_IMAGES_REQUEST_BUDGET_BYTES for the
  // API routes' body cap.
  maxTotalBytes?: number
  // Refuses a PDF with more pages than this (before rendering anything).
  maxPages?:     number
  signal?:       AbortSignal
  onProgress?:   (renderedPageCount: number, totalPageCount: number) => void
}

export type PageRenderErrorCode =
  | "unsupported_type"   // not a PDF/JPEG/PNG (HEIC, Word, …)
  | "too_many_pages"     // PDF has more pages than options.maxPages
  | "pdf_password"       // encrypted PDF
  | "pdf_invalid"        // PDF that pdf.js cannot open
  | "image_invalid"      // photo the browser cannot decode
  | "too_large"          // a page stays over its byte budget even at the smallest size tried
  | "aborted"

export class PageRenderError extends Error {
  constructor(public readonly code: PageRenderErrorCode, message: string) {
    super(message)
    this.name = "PageRenderError"
  }
}

// Sum of the encoded page bytes one API request may carry: the routes cap the JSON body at
// MAX_FUNCTION_UPLOAD_BYTES and base64 inflates by 4/3; 10 % is kept for the JSON around it.
export const PAGE_IMAGES_REQUEST_BUDGET_BYTES = Math.floor(MAX_FUNCTION_UPLOAD_BYTES * 0.9 * 3 / 4)

export const PAGE_RENDER_ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const
// For <input accept="…">.
export const PAGE_RENDER_ACCEPT_ATTRIBUTE = "application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"

// ─── Defaults ────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_WIDTH      = 1600
const DEFAULT_JPEG_QUALITY   = 0.8
const DEFAULT_MAX_PAGE_BYTES = 900 * 1024
// Quality is lowered in these steps before the page is shrunk; below 0.55 handwriting
// suffers more from JPEG artefacts than from a smaller size.
const MINIMUM_JPEG_QUALITY   = 0.55
const QUALITY_STEP           = 0.1
const DOWNSCALE_FACTOR       = 0.85
// Below this width a form page is no longer readable by the vision model: fail instead.
const MINIMUM_PAGE_WIDTH     = 800
// Renders a PDF page no larger than this, whatever its declared size (a poster-sized page
// would otherwise allocate a huge canvas before being scaled down).
const MAXIMUM_PDF_SCALE      = 4

// ─── Entry point ─────────────────────────────────────────────────────────────────────────

export async function renderFileToPageImages(file: File, options: PageRenderOptions = {}): Promise<RenderedPageImage[]> {
  const fileKind = detectFileKind(file)
  if (fileKind === null) {
    throw new PageRenderError("unsupported_type", "Format non pris en charge : PDF, JPEG ou PNG attendu")
  }

  const renderedPages = fileKind === "pdf"
    ? await renderPdfPages(file, options)
    : [await renderPhotoPage(file, options)]

  return renderedPages
}

// Revokes the preview object URLs of pages that are no longer displayed.
export function releasePageImages(pages: readonly Pick<RenderedPageImage, "previewUrl">[]): void {
  for (const page of pages) URL.revokeObjectURL(page.previewUrl)
}

// ─── File type ───────────────────────────────────────────────────────────────────────────

function detectFileKind(file: File): "pdf" | "image" | null {
  const lowerName = file.name.toLowerCase()
  if (file.type === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf"
  if (file.type === "image/jpeg" || file.type === "image/png") return "image"
  // Some browsers/OSes leave `type` empty for camera files; fall back on the extension.
  if (!file.type && /\.(jpe?g|png)$/.test(lowerName)) return "image"
  return null
}

// ─── PDF ─────────────────────────────────────────────────────────────────────────────────

type PdfJsModule = typeof import("pdfjs-dist")

let pdfJsModulePromise: Promise<PdfJsModule> | null = null

// Loaded on first use only: pdf.js is large and touches browser globals at import time, so
// it must never be part of the server render nor of pages that do not render a PDF.
function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist").then((pdfJsModule) => {
      if (!pdfJsModule.GlobalWorkerOptions.workerPort) {
        // `new Worker(new URL(…, import.meta.url))` written literally is what lets Turbopack
        // and webpack emit the worker file as its own asset.
        pdfJsModule.GlobalWorkerOptions.workerPort = new Worker(
          new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
          { type: "module" },
        )
      }
      return pdfJsModule
    }).catch((error: unknown) => {
      // A failed chunk load must not be cached forever — the next call retries.
      pdfJsModulePromise = null
      throw error
    })
  }
  return pdfJsModulePromise
}

async function renderPdfPages(file: File, options: PageRenderOptions): Promise<RenderedPageImage[]> {
  const pdfJs      = await loadPdfJs()
  const fileBytes  = new Uint8Array(await file.arrayBuffer())
  throwIfAborted(options.signal)

  const loadingTask = pdfJs.getDocument({ data: fileBytes })
  let pdfDocument: Awaited<typeof loadingTask.promise>
  try {
    pdfDocument = await loadingTask.promise
  } catch (error) {
    void loadingTask.destroy()
    if (error instanceof Error && error.name === "PasswordException") {
      throw new PageRenderError("pdf_password", "Ce PDF est protégé par un mot de passe")
    }
    throw new PageRenderError("pdf_invalid", "Ce PDF n'a pas pu être ouvert")
  }

  const renderedPages: RenderedPageImage[] = []
  try {
    const pageCount = pdfDocument.numPages
    if (options.maxPages !== undefined && pageCount > options.maxPages) {
      throw new PageRenderError("too_many_pages", `Ce PDF compte ${pageCount} pages (${options.maxPages} maximum)`)
    }
    const pageByteBudget = resolvePageByteBudget(options, pageCount)
    const targetWidth    = options.maxWidth ?? DEFAULT_MAX_WIDTH

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      throwIfAborted(options.signal)
      const pdfPage       = await pdfDocument.getPage(pageNumber)
      const naturalWidth  = pdfPage.getViewport({ scale: 1 }).width
      const scale         = Math.min(MAXIMUM_PDF_SCALE, targetWidth / naturalWidth)
      const viewport      = pdfPage.getViewport({ scale })

      const canvas  = document.createElement("canvas")
      canvas.width  = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const context = getOpaqueContext(canvas)
      // Transparent PDF backgrounds would turn black in the JPEG.
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, canvas.width, canvas.height)
      await pdfPage.render({ canvas, canvasContext: context, viewport }).promise
      pdfPage.cleanup()

      try {
        renderedPages.push(await encodeWithinBudget(canvas, pageByteBudget, options))
      } finally {
        releaseCanvas(canvas)
      }
      options.onProgress?.(pageNumber, pageCount)
    }
    return renderedPages
  } catch (error) {
    releasePageImages(renderedPages)
    throw error
  } finally {
    // Destroying the loading task releases the document in the worker; the shared worker
    // port itself stays up for the next file.
    void loadingTask.destroy()
  }
}

// ─── Photos ──────────────────────────────────────────────────────────────────────────────

async function renderPhotoPage(file: File, options: PageRenderOptions): Promise<RenderedPageImage> {
  const decodedImage = await decodePhoto(file)
  throwIfAborted(options.signal)

  try {
    const targetWidth = Math.min(options.maxWidth ?? DEFAULT_MAX_WIDTH, decodedImage.width)
    const scale       = targetWidth / decodedImage.width
    const canvas      = document.createElement("canvas")
    canvas.width      = Math.round(decodedImage.width * scale)
    canvas.height     = Math.round(decodedImage.height * scale)
    const context     = getOpaqueContext(canvas)
    context.fillStyle = "#ffffff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingQuality = "high"
    context.drawImage(decodedImage.source, 0, 0, canvas.width, canvas.height)

    try {
      const renderedPage = await encodeWithinBudget(canvas, resolvePageByteBudget(options, 1), options)
      options.onProgress?.(1, 1)
      return renderedPage
    } finally {
      releaseCanvas(canvas)
    }
  } finally {
    decodedImage.release()
  }
}

type DecodedPhoto = {
  source:  CanvasImageSource
  width:   number
  height:  number
  release: () => void
}

// createImageBitmap applies the EXIF orientation of phone photos; the <img> fallback (older
// Safari) does too in every browser that lacks the former.
async function decodePhoto(file: File): Promise<DecodedPhoto> {
  if (typeof createImageBitmap === "function") {
    try {
      const imageBitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
      return { source: imageBitmap, width: imageBitmap.width, height: imageBitmap.height, release: () => imageBitmap.close() }
    } catch {
      // Falls through to the <img> path, which some browsers decode more leniently.
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const imageElement = new Image()
    imageElement.src = objectUrl
    await imageElement.decode()
    return {
      source:  imageElement,
      width:   imageElement.naturalWidth,
      height:  imageElement.naturalHeight,
      release: () => URL.revokeObjectURL(objectUrl),
    }
  } catch {
    URL.revokeObjectURL(objectUrl)
    throw new PageRenderError("image_invalid", "Cette image n'a pas pu être lue")
  }
}

// ─── Encoding ────────────────────────────────────────────────────────────────────────────

function resolvePageByteBudget(options: PageRenderOptions, pageCount: number): number {
  const maxPageBytes = options.maxPageBytes ?? DEFAULT_MAX_PAGE_BYTES
  if (options.maxTotalBytes === undefined) return maxPageBytes
  return Math.min(maxPageBytes, Math.floor(options.maxTotalBytes / Math.max(1, pageCount)))
}

// Lowers the JPEG quality first, then shrinks the page, until it fits the budget.
async function encodeWithinBudget(sourceCanvas: HTMLCanvasElement, byteBudget: number, options: PageRenderOptions): Promise<RenderedPageImage> {
  let workingCanvas = sourceCanvas
  let jpegQuality   = options.jpegQuality ?? DEFAULT_JPEG_QUALITY

  try {
    for (;;) {
      throwIfAborted(options.signal)
      const jpegBlob = await canvasToJpegBlob(workingCanvas, jpegQuality)
      if (jpegBlob.size <= byteBudget) {
        return {
          base64:     await blobToBase64(jpegBlob),
          mediaType:  "image/jpeg",
          width:      workingCanvas.width,
          height:     workingCanvas.height,
          previewUrl: URL.createObjectURL(jpegBlob),
        }
      }

      if (jpegQuality - QUALITY_STEP >= MINIMUM_JPEG_QUALITY - 1e-9) {
        jpegQuality -= QUALITY_STEP
        continue
      }

      const nextWidth = Math.round(workingCanvas.width * DOWNSCALE_FACTOR)
      if (nextWidth < MINIMUM_PAGE_WIDTH) {
        throw new PageRenderError("too_large", "Page trop volumineuse, même réduite")
      }
      const smallerCanvas = downscaleCanvas(workingCanvas, nextWidth)
      if (workingCanvas !== sourceCanvas) releaseCanvas(workingCanvas)
      workingCanvas = smallerCanvas
    }
  } finally {
    if (workingCanvas !== sourceCanvas) releaseCanvas(workingCanvas)
  }
}

function downscaleCanvas(sourceCanvas: HTMLCanvasElement, targetWidth: number): HTMLCanvasElement {
  const scale         = targetWidth / sourceCanvas.width
  const smallerCanvas = document.createElement("canvas")
  smallerCanvas.width  = targetWidth
  smallerCanvas.height = Math.round(sourceCanvas.height * scale)
  const context = getOpaqueContext(smallerCanvas)
  context.imageSmoothingQuality = "high"
  context.drawImage(sourceCanvas, 0, 0, smallerCanvas.width, smallerCanvas.height)
  return smallerCanvas
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, jpegQuality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (jpegBlob) => jpegBlob ? resolve(jpegBlob) : reject(new PageRenderError("too_large", "Page trop grande pour être convertie")),
      "image/jpeg",
      jpegQuality,
    )
  })
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error("Lecture de l'image impossible"))
    reader.readAsDataURL(blob)
  })
  return dataUrl.slice(dataUrl.indexOf(",") + 1)
}

function getOpaqueContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d", { alpha: false })
  if (!context) throw new PageRenderError("too_large", "Page trop grande pour être affichée")
  return context
}

// Safari keeps canvas memory alive until the element is collected; shrinking it to 0×0
// frees it right away, which matters when rendering many pages in a row.
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width  = 0
  canvas.height = 0
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new PageRenderError("aborted", "Conversion annulée")
}
