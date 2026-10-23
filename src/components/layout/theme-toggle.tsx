"use client"

import { useState } from "react"
import { useTheme } from "next-themes"
import { useTranslations } from "next-intl"
import { MoonIcon, SunIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Props {
  className?:     string
  iconClassName?: string
}

export function ThemeToggle({ className, iconClassName = "size-4" }: Props = {}) {
  const t = useTranslations("layout.themeToggle")
  const { theme, setTheme } = useTheme()
  const [spins, setSpins] = useState(0)

  function handleClick() {
    setTheme(theme === "dark" ? "light" : "dark")
    setSpins(s => s + 1)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-8", className)}
      onClick={handleClick}
    >
      <span
        key={spins}
        className={cn("relative flex items-center justify-center", iconClassName, spins > 0 && "animate-theme-toggle-spin")}
      >
        <SunIcon className={cn(iconClassName, "rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0")} />
        <MoonIcon className={cn(iconClassName, "absolute rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100")} />
      </span>
      <span className="sr-only">{t("changeTheme")}</span>
    </Button>
  )
}
