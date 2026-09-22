"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { formatMemberCardCheckedAt, type MemberCardCheckedAtParts } from "@/lib/member-card/verify-display"

type MemberCardCheckedAtClockProps = {
  // Already formatted on the server: re-deriving the same instant in the browser for the
  // first render would risk a different ICU rendering (and a hydration mismatch) for no gain.
  initialCheckedAt: MemberCardCheckedAtParts
  locale:           string
  className?:       string
}

// "Vérifiée le … à …", ticking every second. This is the page's only moving part, and it
// isn't decoration: a member can screenshot a valid card and send it to a friend, so the one
// defence a static proof-of-membership page has is a clock that anybody at the door can see
// is stuck — a live page always reads the current second.
export function MemberCardCheckedAtClock({ initialCheckedAt, locale, className }: MemberCardCheckedAtClockProps) {
  const translate = useTranslations("memberCard.verify")
  const [checkedAt, setCheckedAt] = useState(initialCheckedAt)

  // Only the interval is started here, with no immediate setState: the server's instant
  // stays on screen until the first tick, which keeps hydration byte-identical and is at
  // most one second stale.
  useEffect(() => {
    const intervalId = setInterval(() => setCheckedAt(formatMemberCardCheckedAt(new Date(), locale)), 1000)
    return () => clearInterval(intervalId)
  }, [locale])

  return (
    // aria-live="off" so a screen reader doesn't announce a new time every second — the
    // value is read on demand, like any other text on the page.
    <time dateTime={checkedAt.isoTimestamp} aria-live="off" className={className}>
      {translate("checkedAt", { date: checkedAt.date, time: checkedAt.time })}
    </time>
  )
}
