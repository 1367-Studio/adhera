"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { SegmentedControl } from "@/components/ui/segmented-control"
import type { ScanPage } from "./scan-model"

const ZOOM_LEVELS = [1, 1.5, 2, 3] as const

type ScanPageViewerProps = {
  // Slot per page of the form (index 0 = page 1); null = the page is missing from the batch.
  slotPages: (ScanPage | null)[]
}

// The scanned sheet next to the fields: the manager reads the handwriting here while
// correcting the values on the right. Mounted with a `key` per form, so zoom and page reset.
export function ScanPageViewer({ slotPages }: ScanPageViewerProps) {
  const t = useTranslations("paperFormScan.viewer")
  const firstAvailableIndex = Math.max(0, slotPages.findIndex((page) => page !== null))
  const [pageIndex, setPageIndex] = useState(firstAvailableIndex)
  const [zoomIndex, setZoomIndex] = useState(0)

  const currentPage = slotPages[pageIndex] ?? null
  const zoomLevel   = ZOOM_LEVELS[zoomIndex]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {slotPages.length > 1 ? (
          <SegmentedControl
            size="sm"
            ariaLabel={t("pageSwitch")}
            value={String(pageIndex)}
            onChange={(value) => setPageIndex(Number(value))}
            options={slotPages.map((page, slotIndex) => ({
              value: String(slotIndex),
              label: page ? t("page", { number: slotIndex + 1 }) : t("pageMissing", { number: slotIndex + 1 }),
            }))}
          />
        ) : <span />}
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label={t("zoomOut")} disabled={zoomIndex === 0} onClick={() => setZoomIndex(zoomIndex - 1)}>
            <MagnifyingGlassMinusIcon />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{Math.round(zoomLevel * 100)} %</span>
          <Button size="icon-sm" variant="ghost" aria-label={t("zoomIn")} disabled={zoomIndex === ZOOM_LEVELS.length - 1} onClick={() => setZoomIndex(zoomIndex + 1)}>
            <MagnifyingGlassPlusIcon />
          </Button>
        </div>
      </div>

      {currentPage?.status === "error" && (
        <p className="text-xs text-destructive">{t("pageUnread", { error: currentPage.error ?? "" })}</p>
      )}

      {/* Genuine layout need: the sheet scrolls inside a viewport-high frame so the fields on
          the right stay in view while the manager pans across the handwriting. */}
      <div className="h-[70vh] overflow-auto rounded-lg border bg-muted/30">
        {currentPage ? (
          // eslint-disable-next-line @next/next/no-img-element -- in-memory object URL, nothing for next/image to optimise
          <img
            src={currentPage.previewUrl}
            alt={t("pageAlt", { number: pageIndex + 1, file: currentPage.sourceName })}
            width={currentPage.width}
            height={currentPage.height}
            style={{ width: `${zoomLevel * 100}%`, maxWidth: "none", height: "auto" }}
            className="block"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {t("missingPageBody", { number: pageIndex + 1 })}
          </div>
        )}
      </div>
    </div>
  )
}
