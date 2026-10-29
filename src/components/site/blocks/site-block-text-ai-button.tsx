"use client"

import { useState } from "react"
import type { Editor } from "@tiptap/react"
import { RichTextMenu } from "@puckeditor/core"
import { SparkleIcon } from "@phosphor-icons/react/dist/ssr"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AiWriter } from "@/components/ai/ai-writer"

type Props = { editor: Editor | null }

// Sits in the "Texte" block's floating toolbar (see site-block-text.tsx's renderInlineMenu),
// styled with the same RichTextMenu.Control as the native Bold/Italic/Underline buttons so it
// reads as part of Puck's own toolbar rather than a bolted-on extra. Opens in its own Popover
// instead of inline, since Puck's floating menu repositions/closes on selection changes and
// can't host a stateful form.
export function SiteBlockTextAiButton({ editor }: Props) {
  const [open, setOpen] = useState(false)
  if (!editor) return null

  const activeEditor = editor

  function handleInsert(text: string) {
    activeEditor.chain().focus().insertContent(text).run()
    setOpen(false)
  }

  function handleReplace(text: string) {
    activeEditor.chain().focus().setContent(text).run()
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* RichTextMenu.Control is a plain function component with no ref/prop forwarding — it
          can't carry the trigger's floating-ui anchor ref itself, which would leave the popover
          with no reference element to position against. The wrapping <span> is a real DOM node
          for that ref to land on; the click still reaches Base UI's trigger handler through
          normal event bubbling from Control's inner button. */}
      <PopoverTrigger
        nativeButton={false}
        render={
          <span>
            <RichTextMenu.Control
              icon={<SparkleIcon className="text-violet-500 dark:text-violet-400" />}
              onClick={() => {}}
              title="Assistant IA"
            />
          </span>
        }
      />
      <PopoverContent
        className="w-80 overflow-hidden rounded-lg p-0"
        align="start"
        // Puck deselects the block (hiding this toolbar) on any pointerdown it sees outside the
        // block's own DOM — which this popover's content is, since it renders through a portal.
        // Stopped here so typing/clicking inside the AI panel doesn't close the toolbar under it.
        onPointerDown={e => e.stopPropagation()}
      >
        <AiWriter
          currentText={editor.getText()}
          onInsert={handleInsert}
          onReplace={handleReplace}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
