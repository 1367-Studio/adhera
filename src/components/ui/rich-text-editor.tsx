"use client"

import { useEditor, EditorContent, type Editor } from "@tiptap/react"
import { useEffect, useState } from "react"
import StarterKit from "@tiptap/starter-kit"
import LinkExtension from "@tiptap/extension-link"
import Underline from "@tiptap/extension-underline"
import Placeholder from "@tiptap/extension-placeholder"
import {
  Bold, Italic, Underline as UnderlineIcon,
  List, ListOrdered, Heading2, Heading3, SparklesIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { AiWriter } from "@/components/ai/ai-writer"
import { useModules } from "@/lib/user-context"

interface MenuBarProps {
  editor:       Editor | null
  aiOpen:       boolean
  onToggleAi:   () => void
  aiEnabled:    boolean
}

function MenuBar({ editor, aiOpen, onToggleAi, aiEnabled }: MenuBarProps) {
  if (!editor) return null

  const btn = (active: boolean) =>
    cn(
      "p-1.5 rounded transition-colors",
      active
        ? "bg-primary/10 text-primary"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
    )

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b bg-muted/30">
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive("bold"))}>
        <Bold size={14} />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive("italic"))}>
        <Italic size={14} />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btn(editor.isActive("underline"))}>
        <UnderlineIcon size={14} />
      </button>

      <div className="w-px h-4 bg-border mx-1" />

      <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive("heading", { level: 2 }))}>
        <Heading2 size={14} />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={btn(editor.isActive("heading", { level: 3 }))}>
        <Heading3 size={14} />
      </button>

      <div className="w-px h-4 bg-border mx-1" />

      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive("bulletList"))}>
        <List size={14} />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive("orderedList"))}>
        <ListOrdered size={14} />
      </button>

      {aiEnabled && (
        <>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            type="button"
            onClick={onToggleAi}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
              aiOpen
                ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                : "text-muted-foreground hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30",
            )}
          >
            <SparklesIcon size={13} />
            IA
          </button>
        </>
      )}
    </div>
  )
}

interface RichTextEditorProps {
  label?:      string
  required?:   boolean
  value:       string
  onChange:    (value: string) => void
  placeholder?: string
  minHeight?:  string
  error?:      string
}

export function RichTextEditor({
  label,
  required,
  value,
  onChange,
  placeholder = "Rédigez votre contenu…",
  minHeight = "180px",
  error,
}: RichTextEditorProps) {
  const modules   = useModules()
  const aiEnabled = modules.ia
  const [aiOpen, setAiOpen] = useState(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Underline,
      LinkExtension.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const text = event.dataTransfer?.getData("text/plain")
        if (!text) return false
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
        if (pos) view.dispatch(view.state.tr.insertText(text, pos.pos))
        return true
      },
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none focus:outline-none px-3 py-2.5",
        style: `min-height: ${minHeight}`,
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const isEmpty = value === "" || value === "<p></p>"
    const editorEmpty = current === "<p></p>" || editor.isEmpty
    if (isEmpty ? !editorEmpty : current !== value) {
      editor.commands.setContent(value || "")
    }
  }, [value, editor])

  function handleAiInsert(text: string) {
    if (!editor) return
    editor.chain().focus().insertContent(text).run()
    onChange(editor.getHTML())
  }

  function handleAiReplace(text: string) {
    if (!editor) return
    editor.chain().focus().setContent(text).run()
    onChange(editor.getHTML())
  }

  const currentText = editor?.getText() ?? ""

  return (
    <div className="space-y-1.5">
      {label && (
        <Label className={cn(error && "text-destructive")}>
          {label}
          {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
        </Label>
      )}
      <div
        className={cn(
          "rounded-md border bg-background overflow-hidden transition-colors focus-within:ring-1 focus-within:ring-ring",
          error && "border-destructive focus-within:ring-destructive/30",
        )}
      >
        <MenuBar editor={editor} aiOpen={aiOpen} onToggleAi={() => setAiOpen(o => !o)} aiEnabled={aiEnabled} />
        {aiEnabled && aiOpen && (
          <AiWriter
            currentText={currentText}
            onInsert={handleAiInsert}
            onReplace={handleAiReplace}
            onClose={() => setAiOpen(false)}
          />
        )}
        <EditorContent editor={editor} className="overflow-y-auto" />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
