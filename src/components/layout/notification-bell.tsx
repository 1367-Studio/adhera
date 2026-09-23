"use client"

import { useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { BellIcon, ChecksIcon, CircleNotchIcon } from "@phosphor-icons/react/dist/ssr";
import { format, parseISO } from "date-fns"
import { useNotifications, useMarkRead, useMarkAllRead, type Notification } from "@/hooks/use-notifications"
import { useReleaseNotes, type ReleaseNote } from "@/hooks/use-help"
import { useSeenReleaseNotes } from "@/hooks/use-seen-release-notes"
import { openReleaseNotes } from "@/lib/help/release-notes-events"
import { cn, stripHtml } from "@/lib/utils"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"

// Unseen "What's new" entries are merged client-side into the bell's list (no notification
// rows in the database); both kinds are sorted together by date.
type BellItem =
  | { type: "notification"; id: string; sortTime: number; notification: Notification }
  | { type: "releaseNote"; id: string; sortTime: number; releaseNote: ReleaseNote }

function NotificationRow({
  unread,
  title,
  secondaryText,
  dateLabel,
  onClick,
}: {
  unread:         boolean
  title:          string
  secondaryText?: string | null
  dateLabel:      string
  onClick:        () => void
}) {
  return (
    <div
      className={cn(
        // A translucent primary wash across the whole row read as a washed-out
        // pale blue, especially in dark mode — a left accent border marks
        // "unread" clearly without tinting the row itself; hover stays neutral
        // for every row instead of colored.
        "flex gap-2.5 border-l-2 px-4 py-3 text-sm transition-colors cursor-pointer hover:bg-muted/40",
        unread ? "border-l-primary" : "border-l-transparent",
      )}
      onClick={onClick}
    >
      <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")} />
      <div className="min-w-0 flex-1">
        <p className={cn("leading-snug", unread ? "font-semibold text-foreground" : "font-medium text-muted-foreground")}>
          {title}
        </p>
        {secondaryText && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {secondaryText}
          </p>
        )}
        <p className="text-xs text-muted-foreground/60 mt-1">
          {dateLabel}
        </p>
      </div>
    </div>
  )
}

export function NotificationBell() {
  const t = useTranslations("notifications.bell")
  const tHelp = useTranslations("help")
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const scope = pathname.startsWith("/portal/") ? "MEMBRE" : "GESTION"
  const { data: notifications = [] } = useNotifications(scope)
  const markRead    = useMarkRead()
  const markAllRead = useMarkAllRead()

  // Only on the dashboard, where the "What's new" pop-up is mounted (not the backoffice,
  // which has no association context for the release-notes route).
  const showReleaseNotes = scope === "GESTION" && pathname.startsWith("/dashboard")
  const { data: releaseNotes = [] } = useReleaseNotes({ enabled: showReleaseNotes })
  const { seenIds, markSeen } = useSeenReleaseNotes()

  const unread = notifications.filter(n => !n.read)
  // Only unseen entries are listed — seen ones live in the help panel's changelog, so the
  // bell doesn't fill up with old release notes. Nothing until the seen list has loaded.
  const unseenReleaseNotes = showReleaseNotes && seenIds !== null
    ? releaseNotes.filter((releaseNote) => !seenIds.includes(releaseNote.id))
    : []
  const unreadCount = unread.length + unseenReleaseNotes.length

  const bellItems: BellItem[] = [
    ...notifications.map((notification): BellItem => ({
      type: "notification",
      id: notification.id,
      sortTime: new Date(notification.createdAt).getTime(),
      notification,
    })),
    ...unseenReleaseNotes.map((releaseNote): BellItem => ({
      type: "releaseNote",
      id: releaseNote.id,
      sortTime: parseISO(releaseNote.publishedAt).getTime(),
      releaseNote,
    })),
  ].sort((firstItem, secondItem) => secondItem.sortTime - firstItem.sortTime)

  function handleMarkAllRead() {
    if (unread.length > 0) markAllRead.mutate(scope)
    if (unseenReleaseNotes.length > 0) markSeen(unseenReleaseNotes.map((releaseNote) => releaseNote.id))
  }

  function handleReleaseNoteClick(releaseNote: ReleaseNote) {
    markSeen([releaseNote.id])
    setOpen(false)
    openReleaseNotes(releaseNote.id)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        aria-label={t("ariaLabel")}
        aria-expanded={open}
      >
        <BellIcon className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex size-2">
            <span className="animate-ping absolute inline-flex size-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* On mobile this is anchored to the viewport (fixed + inset-x), not to the bell
              button — the button isn't flush against the screen edge (ThemeToggle/UserMenu
              sit after it in the header), so `right-0` relative to it alone overflowed off
              the left edge of narrow screens and got clipped. */}
          <div className="fixed inset-x-2 top-14 z-50 overflow-hidden rounded-lg border border-border bg-card shadow-xl sm:absolute sm:inset-x-auto sm:left-auto sm:right-0 sm:top-10 sm:w-80">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-sm font-medium">
                {t("title")}{unreadCount > 0 && ` (${unreadCount})`}
              </span>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  disabled={markAllRead.isPending}
                  title={t("markAllReadTooltip")}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                >
                  {markAllRead.isPending
                    ? <CircleNotchIcon className="size-3 animate-spin" />
                    : <ChecksIcon className="size-3" />
                  }
                  {t("markAllRead")}
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y">
              {bellItems.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {t("empty")}
                </p>
              )}
              {bellItems.map((bellItem) => bellItem.type === "releaseNote" ? (
                <NotificationRow
                  key={`release-note-${bellItem.id}`}
                  unread
                  title={bellItem.releaseNote.title}
                  secondaryText={tHelp(`changelog.kind.${bellItem.releaseNote.kind}`)}
                  dateLabel={format(parseISO(bellItem.releaseNote.publishedAt), "d MMM", { locale: dateFnsLocale })}
                  onClick={() => handleReleaseNoteClick(bellItem.releaseNote)}
                />
              ) : (
                <NotificationRow
                  key={bellItem.id}
                  unread={!bellItem.notification.read}
                  title={bellItem.notification.title}
                  secondaryText={bellItem.notification.body ? stripHtml(bellItem.notification.body) : null}
                  dateLabel={format(new Date(bellItem.notification.createdAt), "d MMM, HH:mm", { locale: dateFnsLocale })}
                  onClick={() => {
                    const clickedNotification = bellItem.notification
                    if (!clickedNotification.read) markRead.mutate(clickedNotification.id)
                    if (clickedNotification.link) { setOpen(false); router.push(clickedNotification.link) }
                  }}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
