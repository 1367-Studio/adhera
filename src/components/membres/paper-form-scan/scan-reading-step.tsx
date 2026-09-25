"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ScanPage } from "./scan-model"
import type { ReaderStop } from "./use-page-reader"
import { PAPER_FORM_TEMPLATES_PATH } from "./scan-upload-step"

const AI_SETTINGS_PATH = "/dashboard/parametres?tab=integrations"

type ScanReadingStepProps = {
  pages:        ScanPage[]
  isRunning:    boolean
  stop:         ReaderStop | null
  onRetryPage:  (pageId: string) => void
  onRemovePage: (pageId: string) => void
  onRetryAll:   () => void
  onResume:     () => void
  onContinue:   () => void
  onRestart:    () => void
}

export function ScanReadingStep({ pages, isRunning, stop, onRetryPage, onRemovePage, onRetryAll, onResume, onContinue, onRestart }: ScanReadingStepProps) {
  const t = useTranslations("paperFormScan.reading")

  const readCount    = pages.filter((page) => page.status === "done").length
  const failedPages  = pages.filter((page) => page.status === "error")
  // Pages a strict template recognised as another document: final, never grouped into a form.
  const refusedPages = pages.filter((page) => page.status === "refused")
  const pendingCount = pages.filter((page) => page.status === "pending" || page.status === "reading").length
  const processedCount  = readCount + failedPages.length + refusedPages.length
  const progressPercent = pages.length > 0 ? Math.round((processedCount / pages.length) * 100) : 0
  const isFinished   = !isRunning && pendingCount === 0

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm font-medium">{t("progress", { read: readCount, total: pages.length })}</p>
          {(failedPages.length > 0 || refusedPages.length > 0) && (
            <p className="text-sm text-destructive">
              {[
                failedPages.length > 0 ? t("failedCount", { count: failedPages.length }) : null,
                refusedPages.length > 0 ? t("refusedCount", { count: refusedPages.length }) : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent}
          aria-label={t("progress", { read: readCount, total: pages.length })}
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
        {isRunning && <p className="text-xs text-muted-foreground">{t("runningHint")}</p>}
      </div>

      {stop && (
        <div className="space-y-2 border-l-2 border-destructive pl-3">
          <p className="text-sm font-medium text-destructive">
            {stop.kind === "fatal" ? t("stoppedTitle") : t("rateLimitedTitle")}
          </p>
          <p className="text-sm text-muted-foreground">{stop.message}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {stop.visionNotSupported && (
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href={AI_SETTINGS_PATH} />}>
                {t("openAiSettings")}
              </Button>
            )}
            {stop.kind === "fatal" && !stop.visionNotSupported && (
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href={PAPER_FORM_TEMPLATES_PATH} />}>
                {t("openTemplates")}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onResume}>{t("resume")}</Button>
          </div>
        </div>
      )}

      {failedPages.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-medium">{t("failedTitle")}</h3>
            {failedPages.length > 1 && (
              <Button size="sm" variant="ghost" onClick={onRetryAll} disabled={!!stop}>{t("retryAll")}</Button>
            )}
          </div>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">{t("pageColumn")}</TableHead>
                  <TableHead>{t("fileColumn")}</TableHead>
                  <TableHead>{t("errorColumn")}</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedPages.map((page) => (
                  <TableRow key={page.pageId}>
                    <TableCell className="tabular-nums">{page.uploadIndex + 1}</TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">{page.sourceName}</TableCell>
                    <TableCell className="whitespace-normal text-destructive">{page.error}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => onRetryPage(page.pageId)} disabled={!!stop}>{t("retry")}</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {isFinished && <p className="text-xs text-muted-foreground">{t("continueWithFailuresHint")}</p>}
        </div>
      )}

      {refusedPages.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t("refusedTitle")}</h3>
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">{t("pageColumn")}</TableHead>
                  <TableHead>{t("fileColumn")}</TableHead>
                  <TableHead>{t("reasonColumn")}</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {refusedPages.map((page) => (
                  <TableRow key={page.pageId}>
                    <TableCell className="tabular-nums">{page.uploadIndex + 1}</TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">{page.sourceName}</TableCell>
                    <TableCell className="whitespace-normal">
                      <p className="text-destructive">{t("pageRefused")}</p>
                      {page.detectedTitle && (
                        <p className="text-xs text-muted-foreground">{t("detectedDocument", { title: page.detectedTitle })}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => onRemovePage(page.pageId)}>{t("removePage")}</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">{t("refusedHint")}</p>
        </div>
      )}

      <div className="flex justify-between gap-3">
        <Button variant="outline" onClick={onRestart}>{t("restart")}</Button>
        <Button onClick={onContinue} disabled={!isFinished || readCount === 0}>
          {failedPages.length > 0 || refusedPages.length > 0 ? t("continueAnyway") : t("continue")}
        </Button>
      </div>
    </div>
  )
}
