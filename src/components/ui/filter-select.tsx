"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface FilterOption {
  value: string
  label: string
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
  placeholder = "Tous",
  className,
  width = "w-36",
}: FilterSelectProps) {
  const selected = options.find(o => o.value === value)

  return (
    <Select value={value || "__all__"} onValueChange={v => onValueChange(v === "__all__" ? "" : (v ?? ""))}>
      <SelectTrigger className={cn(width, className)}>
        <span className={cn("flex-1 text-left text-sm truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? placeholder}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{placeholder}</SelectItem>
        {options.map(o => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
