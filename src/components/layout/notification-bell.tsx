"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { BellIcon, ChecksIcon, CircleNotchIcon } from "@phosphor-icons/react/dist/ssr";
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useNotifications, useMarkRead, useMarkAllRead } from "@/hooks/use-notifications"
import { cn, stripHtml } from "@/lib/utils"

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { data: notifications = [] } = useNotifications()
  const markRead    = useMarkRead()
  const markAllRead = useMarkAllRead()

  const unread = notifications.filter(n => !n.read)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <BellIcon className="size-4" />
        {unread.length > 0 && (
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
          <div className="fixed inset-x-2 top-14 z-50 overflow-hidden rounded-xl border border-border bg-card shadow-xl sm:absolute sm:inset-x-auto sm:left-auto sm:right-0 sm:top-10 sm:w-80">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-sm font-medium">
                Notifications{unread.length > 0 && ` (${unread.length})`}
              </span>
              {unread.length > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  disabled={markAllRead.isPending}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                >
                  {markAllRead.isPending
                    ? <CircleNotchIcon className="size-3 animate-spin" />
                    : <ChecksIcon className="size-3" />
                  }
                  Tout lire
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto divide-y">
              {notifications.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Aucune notification
                </p>
              )}
              {notifications.map(n => (
                <div
                  key={n.id}
                  className={cn(
                    // A translucent primary wash across the whole row read as a washed-out
                    // pale blue, especially in dark mode — a left accent border marks
                    // "unread" clearly without tinting the row itself; hover stays neutral
                    // for every row instead of colored.
                    "flex gap-2.5 border-l-2 px-4 py-3 text-sm transition-colors cursor-pointer hover:bg-muted/40",
                    !n.read ? "border-l-primary" : "border-l-transparent",
                  )}
                  onClick={() => {
                    if (!n.read) markRead.mutate(n.id)
                    if (n.link) { setOpen(false); router.push(n.link) }
                  }}
                >
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", !n.read ? "bg-primary" : "bg-transparent")} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("leading-snug", !n.read ? "font-semibold text-foreground" : "font-medium text-muted-foreground")}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {stripHtml(n.body)}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {format(new Date(n.createdAt), "d MMM à HH:mm", { locale: fr })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
