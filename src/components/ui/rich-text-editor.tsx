"use client"

import { useEditor, useEditorState, EditorContent, type Editor } from "@tiptap/react"
import { useEffect, useId, useState } from "react"
import StarterKit from "@tiptap/starter-kit"
import LinkExtension from "@tiptap/extension-link"
import Underline from "@tiptap/extension-underline"
import Placeholder from "@tiptap/extension-placeholder"
import { useTranslations } from "next-intl"
import {
  TextBIcon, TextItalicIcon, TextUnderlineIcon as UnderlineIcon, ListIcon, ListNumbersIcon,
  TextHTwoIcon, TextHThreeIcon, SparkleIcon, LinkIcon, LinkBreakIcon, CaretDownIcon,
} from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DOCUMENT_PROSE } from "@/components/ui/rich-text-view"
import { AiWriter } from "@/components/ai/ai-writer"
import { useModules } from "@/lib/user-context"

// "default" is the compact editor used across forms and emails (H2/H3 toggles only).
// "document" is for long-form pages: H1–H3 through a block-style menu, a toolbar that stays
// visible while scrolling, and the same heading scale the reader renders with.
export type RichTextEditorVariant = "default" | "document"

const toolbarBtn = (active: boolean) =>
  cn(
    "p-1.5 rounded transition-colors",
    active
      ? "bg-primary/10 dark:bg-primary/20 text-primary"
      : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
  )

// A bare "example.org" would be stored as a relative href and resolve against the current
// page — prepend a scheme unless the user gave one (http, https, mailto, tel).
function normalizeHref(raw: string): string {
  const v = raw.trim()
  if (!v) return ""
  return /^(https?:|mailto:|tel:)/i.test(v) ? v : `https://${v}`
}

interface LinkButtonProps {
  editor:      Editor
  active:      boolean
  currentHref: string
}

function LinkButton({ editor, active, currentHref }: LinkButtonProps) {
  const t       = useTranslations("richTextEditor")
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [url, setUrl]   = useState("")

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setUrl(currentHref)
  }

  function remove() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run()
    setOpen(false)
  }

  function apply() {
    const href = normalizeHref(url)
    if (!href) { remove(); return }
    const { from, to } = editor.state.selection
    if (from === to && !active) {
      // Caret only, not on an existing link: insert the URL itself as the link text.
      editor.chain().focus().insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run()
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run()
    }
    setOpen(false)
  }

  // Deliberately not a <form>: the popover portals out of the DOM but React events still
  // bubble through the tree, so a nested submit would fire the host page's own form.
  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger className={toolbarBtn(active)} title={t("link")} aria-label={t("link")}>
        <LinkIcon size={14} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>{t("urlLabel")}</Label>
          <Input
            id={inputId}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply() } }}
            placeholder="https://"
            autoFocus
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          {active ? (
            <Button type="button" variant="ghost" size="sm" onClick={remove}>
              <LinkBreakIcon className="size-3.5" />
              {t("remove")}
            </Button>
          ) : <span />}
          <Button type="button" size="sm" disabled={!url.trim()} onClick={apply}>
            {t("apply")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

type BlockStyle = "paragraph" | "heading1" | "heading2" | "heading3"

const BLOCK_STYLE_LABEL_KEYS: Record<BlockStyle, "normalText" | "heading1" | "heading2" | "heading3"> = {
  paragraph: "normalText",
  heading1:  "heading1",
  heading2:  "heading2",
  heading3:  "heading3",
}

const BLOCK_STYLES: BlockStyle[] = ["paragraph", "heading1", "heading2", "heading3"]

interface BlockStyleMenuProps {
  editor:       Editor
  currentStyle: BlockStyle | null
}

function BlockStyleMenu({ editor, currentStyle }: BlockStyleMenuProps) {
  const t = useTranslations("richTextEditor")

  // Running the command with .focus() puts DOM focus back in the editor (ProseMirror keeps
  // the selection in its state while blurred). Base UI then sees focus already outside the
  // menu when it closes and does not return it to the trigger, so writing just continues.
  // Wired to each item's onClick rather than the group's onValueChange, which does not fire
  // when re-picking the current style — focus would then land on the trigger instead.
  function applyStyle(style: BlockStyle) {
    const chain = editor.chain().focus()
    if (style === "paragraph") chain.setParagraph().run()
    else if (style === "heading1") chain.setHeading({ level: 1 }).run()
    else if (style === "heading2") chain.setHeading({ level: 2 }).run()
    else chain.setHeading({ level: 3 }).run()
  }

  const currentLabel = t(BLOCK_STYLE_LABEL_KEYS[currentStyle ?? "paragraph"])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          toolbarBtn(false),
          "inline-flex h-6.5 w-28 items-center justify-between gap-1 px-2 text-xs font-medium",
        )}
        // Names the control and still announces the current style, which a bare
        // "Style de paragraphe" label would hide from screen readers.
        aria-label={`${t("paragraphStyle")} : ${currentLabel}`}
        title={t("paragraphStyle")}
      >
        <span className="truncate">{currentLabel}</span>
        <CaretDownIcon size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={currentStyle}>
          {BLOCK_STYLES.map(style => (
            <DropdownMenuRadioItem key={style} value={style} closeOnClick onClick={() => applyStyle(style)}>
              {t(BLOCK_STYLE_LABEL_KEYS[style])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface MenuBarProps {
  editor:       Editor | null
  aiOpen:       boolean
  onToggleAi:   () => void
  aiEnabled:    boolean
  variant:      RichTextEditorVariant
}

function MenuBar({ editor, aiOpen, onToggleAi, aiEnabled, variant }: MenuBarProps) {
  // Tiptap v3 stopped re-rendering on every transaction, so `editor.isActive(...)` read
  // directly in render only refreshes on the next unrelated React render. useEditorState
  // subscribes to the editor and re-renders the toolbar when any of these change.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold:        e?.isActive("bold") ?? false,
      italic:      e?.isActive("italic") ?? false,
      underline:   e?.isActive("underline") ?? false,
      paragraph:   e?.isActive("paragraph") ?? false,
      h1:          e?.isActive("heading", { level: 1 }) ?? false,
      h2:          e?.isActive("heading", { level: 2 }) ?? false,
      h3:          e?.isActive("heading", { level: 3 }) ?? false,
      bulletList:  e?.isActive("bulletList") ?? false,
      orderedList: e?.isActive("orderedList") ?? false,
      link:        e?.isActive("link") ?? false,
      linkHref:    (e?.getAttributes("link").href as string | undefined) ?? "",
    }),
  })

  if (!editor || !state) return null
  const btn = toolbarBtn
  const isDocument = variant === "document"

  // A selection spanning several block types matches none of these — the menu then shows
  // "Texte normal" as its label but checks no item.
  const currentStyle: BlockStyle | null =
    state.h1 ? "heading1"
    : state.h2 ? "heading2"
    : state.h3 ? "heading3"
    : state.paragraph ? "paragraph"
    : null

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b bg-muted/30">
      {isDocument && (
        <>
          <BlockStyleMenu editor={editor} currentStyle={currentStyle} />
          <div className="w-px h-4 bg-border mx-1" />
        </>
      )}
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(state.bold)}>
        <TextBIcon size={14} />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(state.italic)}>
        <TextItalicIcon size={14} />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btn(state.underline)}>
        <UnderlineIcon size={14} />
      </button>
      <LinkButton editor={editor} active={state.link} currentHref={state.linkHref} />

      <div className="w-px h-4 bg-border mx-1" />

      {!isDocument && (
        <>
          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(state.h2)}>
            <TextHTwoIcon size={14} />
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={btn(state.h3)}>
            <TextHThreeIcon size={14} />
          </button>

          <div className="w-px h-4 bg-border mx-1" />
        </>
      )}

      <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(state.bulletList)}>
        <ListIcon size={14} />
      </button>
      <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(state.orderedList)}>
        <ListNumbersIcon size={14} />
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
            <SparkleIcon size={13} />
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
  variant?:    RichTextEditorVariant
}

const EDITOR_CONTENT_CLASS = "prose prose-sm dark:prose-invert max-w-none focus:outline-none px-3 py-2.5"

export function RichTextEditor({
  label,
  required,
  value,
  onChange,
  placeholder = "Rédigez votre contenu…",
  minHeight = "180px",
  error,
  variant = "default",
}: RichTextEditorProps) {
  const modules    = useModules()
  const aiEnabled  = modules.ia
  const isDocument = variant === "document"
  const [aiOpen, setAiOpen] = useState(false)

  const editor = useEditor({
    extensions: [
      isDocument
        ? StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false, underline: false })
        : StarterKit.configure({ link: false, underline: false }),
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
        class: isDocument ? `${EDITOR_CONTENT_CLASS} ${DOCUMENT_PROSE}` : EDITOR_CONTENT_CLASS,
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
          "rounded-md border bg-background",
          // overflow-hidden would make this wrapper the sticky toolbar's scroll container
          // and pin it in place; overflow-clip still clips to the rounded border without that.
          isDocument ? "overflow-clip" : "overflow-hidden",
          "transition-colors focus-within:ring-1 focus-within:ring-ring",
          error && "border-destructive focus-within:ring-destructive/30",
        )}
      >
        {isDocument ? (
          // Stays visible while writing a long document. Below md the window scrolls under
          // the sticky h-14 app header, so it sticks right beneath it; from md up the
          // dashboard's <main> is the scroll container and the header sits outside it.
          <div className="sticky top-14 z-10 bg-background md:top-0">
            <MenuBar editor={editor} aiOpen={aiOpen} onToggleAi={() => setAiOpen(o => !o)} aiEnabled={aiEnabled} variant={variant} />
          </div>
        ) : (
          <MenuBar editor={editor} aiOpen={aiOpen} onToggleAi={() => setAiOpen(o => !o)} aiEnabled={aiEnabled} variant={variant} />
        )}
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
