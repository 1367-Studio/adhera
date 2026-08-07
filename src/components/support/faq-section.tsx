"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { PlusIcon, MinusIcon } from "@phosphor-icons/react/dist/ssr"
import { FaqList } from "@/components/support/faq-list"

type FaqItem = { question: string; answer: string }
type FaqCategory = { label: string; items: FaqItem[] }

export function FaqSection() {
  const t = useTranslations("support.faq")
  const categories = t.raw("categories") as Record<string, FaqCategory>
  const categoryKeys = Object.keys(categories)
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set())

  if (categoryKeys.length === 0) return null

  function toggle(key: string) {
  setOpenKeys(prev => {
    const next = new Set(prev)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    return next
  })
}

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight">{t("sectionTitle")}</h2>
      <div className="space-y-2">
        {categoryKeys.map(key => {
          const isOpen = openKeys.has(key)
          return (
            <div key={key} className="rounded-lg border">
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium hover:bg-muted/40"
              >
                {categories[key].label}
                {isOpen ? <MinusIcon className="size-4 shrink-0 text-muted-foreground" /> : <PlusIcon className="size-4 shrink-0 text-muted-foreground" />}
              </button>
              {isOpen && (
                <div className="border-t p-3">
                  <FaqList items={categories[key].items} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
