"use client"

import { useState } from "react"
import { Modal } from "@/components/ui/modal"
import { RichTextView } from "@/components/ui/rich-text-view"

type Props = { content: string; triggerLabel: string; title: string }

// The full CGV text used to render inline on the public form, making an already dense page
// even longer — collapsed behind a link, shown on demand instead. Shared between the
// donation and membership public forms (same field, same behavior — see CLAUDE.md's
// consistency rule).
export function TermsModal({ content, triggerLabel, title }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {triggerLabel}
      </button>
      <Modal open={open} onOpenChange={setOpen} title={title} size="lg">
        <RichTextView content={content} className="text-sm text-foreground/90" />
      </Modal>
    </>
  )
}
