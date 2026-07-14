"use client"

import { useState } from "react"
import { useTheme } from "next-themes"
import { MoonIcon, SunIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ThemeToggle() {
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
      className="size-8"
      onClick={handleClick}
    >
      <span
        key={spins}
        className={cn("relative flex size-4 items-center justify-center", spins > 0 && "animate-theme-toggle-spin")}
      >
        <SunIcon weight="fill" className="size-4 rotate-0 scale-100 text-amber-500 transition-all dark:-rotate-90 dark:scale-0" />
        <MoonIcon weight="fill" className="absolute size-4 rotate-90 scale-0 text-indigo-400 transition-all dark:rotate-0 dark:scale-100" />
      </span>
      <span className="sr-only">Changer le thème</span>
    </Button>
  )
}
