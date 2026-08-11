"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { format } from "date-fns"
import { CircleNotchIcon, EnvelopeSimpleIcon, CaretDownIcon, WarningCircleIcon, ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"
import { cn } from "@/lib/utils"
import { sanitizeEmailPreviewHtml } from "@/lib/sanitize-email-preview"

const PAGE_SIZE = 20

type InformationalRow = {
  id:        string
  subject:   string
  html:      string | null
  status:    string
  to:        string
  sentAt:    string | null
  createdAt: string
  user:      { name: string | null; email: string; role: string } | null
  membre:    { firstName: string; lastName: string } | null
}

function InformationalItem({ row }: { row: InformationalRow }) {
  const [open, setOpen] = useState(false)
  const t = useTranslations("support")
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)
  const sanitizedHtml = row.html ? sanitizeEmailPreviewHtml(row.html) : null
  const recipient = row.user
    ? `${row.user.name ?? row.user.email} · ${row.user.role}`
    : row.membre
      ? `${row.membre.firstName} ${row.membre.lastName}`
      : row.to

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-sm text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-start gap-2.5 min-w-0">
          <EnvelopeSimpleIcon className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="font-medium truncate">{row.subject}</p>
            <p className="text-xs text-muted-foreground truncate">
              {t("informational.to")} {recipient} · {t("informational.sentAt")} {format(new Date(row.createdAt), "d MMM yyyy, HH:mm", { locale: dateFnsLocale })}
            </p>
          </div>
        </div>
        <CaretDownIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t px-4 py-3">
          {sanitizedHtml ? (
            <iframe
              srcDoc={sanitizedHtml}
              sandbox=""
              referrerPolicy="no-referrer"
              title={row.subject}
              className="w-full h-96 rounded-md border bg-white"
            />
          ) : (
            <p className="text-sm text-muted-foreground italic">—</p>
          )}
        </div>
      )}
    </div>
  )
}

export function SupportInformationalMessages() {
  const t = useTranslations("support")
  const [rows, setRows]         = useState<InformationalRow[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError]       = useState(false)

  const load = useCallback((targetPage: number, append: boolean) => {
    setError(false)
    if (append) setLoadingMore(true)
    else setLoading(true)
    fetch(`/api/support-emails?page=${targetPage}&pageSize=${PAGE_SIZE}`)
      .then(res => { if (!res.ok) throw new Error(); return res.json() })
      .then(({ data, total: t }) => {
        setRows(prev => append ? [...prev, ...data] : data)
        setTotal(t)
        setPage(targetPage)
      })
      .catch(() => setError(true))
      .finally(() => { setLoading(false); setLoadingMore(false) })
  }, [])

  useEffect(() => { load(1, false) }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground">
        <CircleNotchIcon className="size-4 animate-spin mr-2" />
        <span className="text-sm">…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        <WarningCircleIcon className="size-4 shrink-0" />
        {t("informational.error")}
        <Button size="sm" variant="outline" onClick={() => load(1, false)} className="ml-auto h-7 text-xs">
          {t("informational.retry")}
        </Button>
      </div>
    )
  }

  const refreshButton = (
    <div className="flex justify-end">
      <Button size="sm" variant="outline" onClick={() => load(1, false)} className="h-7 text-xs">
        <ArrowsClockwiseIcon className="mr-1.5 size-3" />
        {t("informational.refresh")}
      </Button>
    </div>
  )

  if (rows.length === 0) {
    return (
      <div className="space-y-3">
        {refreshButton}
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t("informational.empty")}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {refreshButton}
      <div className="space-y-2">
        {rows.map(row => <InformationalItem key={row.id} row={row} />)}
      </div>
      {rows.length < total && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
          <span>{t("informational.shownOfTotal", { shown: rows.length, total })}</span>
          <Button size="sm" variant="outline" onClick={() => load(page + 1, true)} disabled={loadingMore} className="h-7 text-xs">
            {loadingMore ? <CircleNotchIcon className="size-3 animate-spin" /> : t("informational.loadMore")}
          </Button>
        </div>
      )}
    </div>
  )
}
