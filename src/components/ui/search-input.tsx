"use client"

import { useTranslations } from "next-intl"
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface SearchInputProps extends Omit<React.ComponentProps<typeof Input>, "onChange" | "value" | "type"> {
  value:         string
  onValueChange: (value: string) => void
  /** Called by the clear button instead of onValueChange("") — lets pages skip their debounce. */
  onClear?:      () => void
  /** Width/positioning of the wrapper (the input itself is w-full). */
  containerClassName?: string
}

// The one toolbar search field. Every management page hand-rolled its own copy of this
// (each with a different height/radius/width); this wraps the shared Input so search
// fields stay aligned with FilterSelect and Button by construction.
export function SearchInput({ value, onValueChange, onClear, containerClassName, className, ...props }: SearchInputProps) {
  const t = useTranslations("common")
  return (
    <div className={cn("relative w-64", containerClassName)}>
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="text"
        value={value}
        onChange={e => onValueChange(e.target.value)}
        className={cn("pl-9 pr-8", className)}
        {...props}
      />
      {value && (
        <button
          type="button"
          aria-label={t("clearSearch")}
          onClick={() => (onClear ? onClear() : onValueChange(""))}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}
