"use client"

import { Fragment } from "react"
import { useTranslations } from "next-intl"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface FilterOption {
  value: string
  label: string
  // Renders a separator above this option — for a trailing action mixed into an otherwise
  // plain list of filter values (e.g. "Fusionner les catégories en double" on the Cotisations
  // page's tier filter), so it doesn't read as just another selectable category.
  separatorBefore?: boolean
}

interface FilterSelectProps {
  value:          string
  onValueChange:  (value: string) => void
  options:        FilterOption[]
  placeholder?:   string
  className?:     string
  width?:         string
}

export function FilterSelect({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  width = "w-36",
}: FilterSelectProps) {
  const t = useTranslations("common")
  const effectivePlaceholder = placeholder ?? t("allPlaceholder")
  const selected = options.find(o => o.value === value)

  return (
    <Select value={value || "__all__"} onValueChange={v => onValueChange(v === "__all__" ? "" : (v ?? ""))}>
      <SelectTrigger className={cn(width, className)}>
        <span title={selected?.label ?? effectivePlaceholder} className={cn("min-w-0 flex-1 text-left text-sm truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? effectivePlaceholder}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{effectivePlaceholder}</SelectItem>
        {options.map(o => (
          <Fragment key={o.value}>
            {o.separatorBefore && <SelectSeparator />}
            <SelectItem value={o.value}>{o.label}</SelectItem>
          </Fragment>
        ))}
      </SelectContent>
    </Select>
  )
}
