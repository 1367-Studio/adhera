import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";

export function InAppBrowserBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 bg-muted text-muted-foreground text-xs px-4 py-2 text-center">
      <ArrowSquareOutIcon className="size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}
