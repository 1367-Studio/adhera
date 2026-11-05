import type { CSSProperties } from "react"

const ARCH_PATH =
  "M765 0V765H592.875V508.725C592.875 452.93 570.71 399.421 531.258 359.968C491.805 320.515 438.295 298.35 382.5 298.35C326.705 298.35 273.195 320.515 233.742 359.968C194.29 399.421 172.125 452.93 172.125 508.725V765H0V0H765Z"

const SPEED_LINE_COUNT = 10

interface AuthLoadingOverlayProps {
  active: boolean
  label: string
}

// Covers the gap between the form's own spinner stopping and the browser
// actually landing on the destination page: the server action's redirect
// settles before NextAuth's jwt callback (association + user lookups,
// lastSeenAt update) and the destination page's own data fetch complete, so
// without this the screen otherwise sits still with no feedback.
//
// The mark "approaches" one copy at a time inside a clipped stage — it grows
// fully opaque the whole time it's visible so it never blends with a sibling
// copy, then the frame sits empty for a beat before the next one starts.
export function AuthLoadingOverlay({ active, label }: AuthLoadingOverlayProps) {
  if (!active) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background">
      <div className="relative size-64 overflow-hidden">
        {Array.from({ length: SPEED_LINE_COUNT }, (_, i) => {
          const angle = (360 / SPEED_LINE_COUNT) * i
          const delay = -((2 / SPEED_LINE_COUNT) * i)
          const duration = 1.8 + (i % 3) * 0.15
          return (
            <div
              key={i}
              className="animate-auth-speed-line absolute top-1/2 left-1/2 h-[44%] w-0.5 origin-top"
              style={{
                background: "linear-gradient(to top, transparent, var(--primary) 55%, transparent)",
                "--angle": `${angle}deg`,
                "--delay": `${delay}s`,
                animationDuration: `${duration}s`,
              } as CSSProperties}
            />
          )
        })}
        <svg
          className="animate-auth-arch absolute top-1/2 left-1/2 size-28 -translate-x-1/2 -translate-y-1/2"
          viewBox="0 0 765 765"
          role="img"
          aria-hidden
          focusable="false"
        >
          <path d={ARCH_PATH} fill="var(--primary)" />
        </svg>
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}
