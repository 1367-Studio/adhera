import { AsteriskIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"

interface LogoMarkProps {
  className?: string
}

// The formwise.fr brand mark: white asterisk on the brand orange (#f84a00, see
// form-wise-app's public/icons/icon.svg and manifest.json's theme_color) — fixed regardless
// of the app's own light/dark theme, same as the source icon. This repo used to render the
// app name's first letter as a placeholder badge instead.
export function LogoMark({ className }: LogoMarkProps) {
  return (
    <div
      className={cn(
        "flex aspect-square size-8 items-center justify-center rounded-lg bg-[#f84a00] text-white",
        className,
      )}
    >
      <AsteriskIcon weight="bold" className="size-4" />
    </div>
  )
}
