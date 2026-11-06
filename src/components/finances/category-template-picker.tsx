"use client"

import { useTranslations } from "next-intl"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr"
import { DEFAULT_FINANCE_CATEGORIES, type DefaultFinanceCategory } from "@/lib/finance/default-categories"
import { Button } from "@/components/ui/button"
import type { Category } from "@/components/finances/categories-view"

interface CategoryTemplatePickerProps {
  type:             "INCOME" | "EXPENSE"
  // Every category this association has under a default `key`, active or archived — lets each
  // template route to the right action instead of just disabling the button when one already
  // exists (see onSelectExisting/onReactivate below).
  categoriesByKey:  Map<string, Category>
  onSelectTemplate: (template: DefaultFinanceCategory) => void
  // Template already has an ACTIVE category under that key — clicking opens it for editing
  // instead of silently doing nothing.
  onSelectExisting: (category: Category) => void
  // Template's category was ARCHIVED (its key is free again, but recreating a look-alike would
  // orphan the original's history) — clicking reactivates the original row instead.
  onReactivate:     (category: Category) => void
  onSelectCustom:   () => void
}

export function CategoryTemplatePicker({ type, categoriesByKey, onSelectTemplate, onSelectExisting, onReactivate, onSelectCustom }: CategoryTemplatePickerProps) {
  const t = useTranslations("finances.categoriesView")
  const templates = DEFAULT_FINANCE_CATEGORIES.filter(c => c.type === type)

  return (
    <div className="space-y-3">
      <ul className="space-y-1 max-h-80 overflow-y-auto">
        {templates.map(template => {
          const match = categoriesByKey.get(template.key)
          const onClick = !match
            ? () => onSelectTemplate(template)
            : match.archivedAt
              ? () => onReactivate(match)
              : () => onSelectExisting(match)
          return (
            <li key={template.key}>
              <button
                type="button"
                onClick={onClick}
                className="flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="font-medium">{template.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{template.description}</span>
                </span>
                {match && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {match.archivedAt ? t("archivedReactivateHint") : t("alreadyExists")}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      <Button type="button" variant="outline" className="w-full justify-center" onClick={onSelectCustom}>
        <PlusIcon className="mr-1.5 size-4" />
        {t("customCategory")}
      </Button>
    </div>
  )
}
