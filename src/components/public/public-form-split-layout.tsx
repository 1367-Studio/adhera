import type { ReactNode } from "react"

// Shared chrome for the public adhesion/event forms: a presentation panel (image,
// title, description, contact) on the left and the actual form on the right. Both
// pages used to hand-roll this (and only the event form actually split into two
// columns — the membership form stacked everything in one column), so they drifted
// in width, background and header treatment. Centralizing it keeps the two in sync.
export function PublicFormSplitLayout({
  header,
  banners,
  left,
  right,
}: {
  header: ReactNode
  banners?: ReactNode
  left: ReactNode
  right: ReactNode
}) {
  return (
    <div className="dashboard-canvas public-canvas min-h-screen p-3">
      <div className="min-h-[calc(100vh-1.5rem)] rounded-[10px] bg-public-panel flex items-start justify-center py-12 px-4">
        <div className="w-full max-w-5xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">{header}</div>
          {banners}
          <div className="grid gap-8 lg:grid-cols-[2fr_3fr] items-start">
            <div className="space-y-6 lg:sticky lg:top-12">{left}</div>
            <div className="space-y-6">{right}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
