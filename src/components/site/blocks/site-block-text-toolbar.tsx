"use client"

import type { ReactNode } from "react"
import type { Editor } from "@tiptap/react"
import { RichTextMenu } from "@puckeditor/core"
import { SiteBlockTextAiButton } from "@/components/site/blocks/site-block-text-ai-button"

type Props = { children: ReactNode; editor: Editor | null }

// Isolated in its own "use client" module: site-block-text.tsx has no directive of its own
// (it's imported from server code too, to SSR the public page's <Render>), and RichTextMenu is
// a client-only export of @puckeditor/core — missing entirely from its react-server build. A
// bare import of it at the top of site-block-text.tsx would break that server-side render.
export function SiteBlockTextInlineMenu({ children, editor }: Props) {
  return (
    <RichTextMenu>
      {children}
      <RichTextMenu.Group>
        <RichTextMenu.AlignSelect />
      </RichTextMenu.Group>
      <RichTextMenu.Group>
        <SiteBlockTextAiButton editor={editor} />
      </RichTextMenu.Group>
    </RichTextMenu>
  )
}
