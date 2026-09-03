"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ContactSupportModal } from "./contact-support-modal"

// Self-contained (owns its own open state) so it can drop into the auth pages, which are
// Server Components — those can't hold state themselves, and this is the one bit of the
// footer that needs to.
export function ContactSupportTrigger() {
  const t = useTranslations("auth.contact")
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground transition-colors"
      >
        {t("trigger")}
      </button>
      {open && <ContactSupportModal onClose={() => setOpen(false)} />}
    </>
  )
}
