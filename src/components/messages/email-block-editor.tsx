"use client"

import { useEffect, useImperativeHandle, useRef, type Ref } from "react"
import { useTranslations } from "next-intl"
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DotsSixIcon, TrashIcon, CopyIcon, TextTIcon, ImageIcon, CursorClickIcon, MinusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { ColorField } from "@/components/ui/color-field"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { ImageUpload } from "@/components/ui/image-upload"
import { VariableTokenChips, getEmailVariableTokens } from "@/components/messages/variable-token-chips"
import { cn, normalizeHref } from "@/lib/utils"
import { isColorDark } from "@/lib/color"
import type { EmailBlock } from "@/lib/email-blocks"

const DEFAULT_BUTTON_COLOR = "#18181b"

let nextTempId = 0
function newBlockId(): string { return `block-${Date.now()}-${nextTempId++}` }

function emptyBlock(type: EmailBlock["type"]): EmailBlock {
  switch (type) {
    case "text":    return { id: newBlockId(), type: "text", html: "" }
    case "image":   return { id: newBlockId(), type: "image", url: "" }
    case "button":  return { id: newBlockId(), type: "button", label: "", url: "", color: DEFAULT_BUTTON_COLOR }
    case "divider": return { id: newBlockId(), type: "divider" }
  }
}

// Same shape as SortableTierCard in membership-tiers-editor.tsx (grip on a left rail so it
// never lands on top of a field, actions pinned to a right rail) — only the grip carries the
// drag listeners, the rest of the card is full of inputs a pointer-down must still reach.
function SortableBlockCard({ id, dragLabel, duplicateLabel, removeLabel, onDuplicate, onRemove, children }: {
  id:             string
  dragLabel:      string
  duplicateLabel: string
  removeLabel:    string
  onDuplicate:    () => void
  onRemove:       () => void
  children:       React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-start gap-2 rounded-md border border-input p-3", isDragging && "relative z-10 opacity-60")}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        ref={setActivatorNodeRef}
        aria-label={dragLabel}
        title={dragLabel}
        className="mt-1 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <DotsSixIcon className="size-4" />
      </Button>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="mt-1 flex shrink-0 items-center gap-0.5">
        <Button type="button" variant="ghost" size="icon" onClick={onDuplicate} aria-label={duplicateLabel} title={duplicateLabel}>
          <CopyIcon className="size-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label={removeLabel} title={removeLabel}>
          <TrashIcon className="size-4" />
        </Button>
      </div>
    </div>
  )
}

// Resolved right before the template is actually saved — see resolvePendingUploads below.
// Uploading a picked file to R2 immediately (the way ImageUpload defaults to) would leave an
// orphaned file behind every time an admin picks an image then cancels the modal, removes the
// block, or replaces it with a different file — same reasoning as the lazy upload already used
// for the association logo in branding-settings.tsx, just needing to track one pending file
// per block instead of a single one.
type PendingUpload = { blockId: string; blobUrl: string; file: File }

export type EmailBlockEditorHandle = {
  // Uploads every block's still-pending local file to R2 and returns `blocks` with each one's
  // `url` swapped for the real result — never persist a blob: URL, it's only valid in this
  // browser tab and would be a broken <img src> for anyone who actually receives the email.
  // Throws on the first upload failure; caller should show that message and abort the save.
  resolvePendingUploads: () => Promise<EmailBlock[]>
  // For the "Pré-visualiser" button, not save: swaps each pending image's blob: URL for a
  // data: URI (base64) instead of uploading anything to R2. A blob: URL only resolves inside
  // the tab that created it — the preview endpoint's sandboxed iframe has an opaque origin
  // (sandbox="" with no allow-same-origin) and can't load it, so the image would just look
  // broken there — but uploading for a preview the admin might never actually save would
  // leave the exact orphaned-R2-file problem resolvePendingUploads exists to avoid. A data:
  // URI sidesteps both: no upload, and it renders from any origin.
  getPreviewBlocks: () => Promise<EmailBlock[]>
}

interface EmailBlockEditorProps {
  blocks:   EmailBlock[]
  onChange: (blocks: EmailBlock[]) => void
  ref?:     Ref<EmailBlockEditorHandle>
}

// Vertical stack of editable blocks (text/image/button/divider) — each card already renders
// its real content inline (a Text block's card IS the RichTextEditor, a Button block's card
// IS its label/url/color fields), so there's no separate "preview" mode to keep in sync. Used
// by template-modal.tsx when a MessageTemplate is in design mode (blocks != null) — see
// MessageTemplate.blocks in prisma/schema.prisma and renderBlocksToHtml() in
// src/lib/email-blocks.ts, which turns this shape into the HTML actually sent.
export function EmailBlockEditor({ blocks, onChange, ref }: EmailBlockEditorProps) {
  const t     = useTranslations("messages.blockEditor")
  const tRoot = useTranslations()
  const variables = getEmailVariableTokens(tRoot)

  // Keyed by block id — at most one pending file per image block (picking a new one before
  // saving just replaces the previous pending entry, so only the file actually kept gets
  // uploaded). A ref, not state: it never drives a render on its own, only resolvePendingUploads
  // (called imperatively at save time) reads it.
  const pendingUploads = useRef<Map<string, PendingUpload>>(new Map())

  useEffect(() => {
    // Revokes every blob: URL still pending when the editor itself unmounts (modal closed
    // without saving) — the per-block revocations in removeBlock/handleFilePending below cover
    // the two other ways a pending file stops being pending.
    return () => { for (const { blobUrl } of pendingUploads.current.values()) URL.revokeObjectURL(blobUrl) }
  }, [])

  // Same 8px activation distance as membership-tiers-editor.tsx — enough that a plain click
  // on the grip, or a small drift while clicking a field, isn't read as a drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function addBlock(type: EmailBlock["type"]) {
    onChange([...blocks, emptyBlock(type)])
  }
  function updateBlock(id: string, patch: Partial<EmailBlock>) {
    onChange(blocks.map(b => (b.id === id ? ({ ...b, ...patch } as EmailBlock) : b)))
  }
  // ImageUpload's lazy mode: picking a file only creates a local blob: preview and hands the
  // File itself here — the real /api/upload only happens in resolvePendingUploads, at save
  // time. A second pick on the same block replaces its still-unsaved predecessor, so that
  // blob: URL is revoked immediately rather than leaking until the editor unmounts.
  function handleFilePending(blockId: string, blobUrl: string, file: File) {
    const previous = pendingUploads.current.get(blockId)
    if (previous) URL.revokeObjectURL(previous.blobUrl)
    pendingUploads.current.set(blockId, { blockId, blobUrl, file })
    updateBlock(blockId, { url: blobUrl })
  }
  function removeBlock(id: string) {
    const pending = pendingUploads.current.get(id)
    if (pending) { URL.revokeObjectURL(pending.blobUrl); pendingUploads.current.delete(id) }
    onChange(blocks.filter(b => b.id !== id))
  }
  function duplicateBlock(id: string) {
    const index = blocks.findIndex(b => b.id === id)
    if (index === -1) return
    const newId = newBlockId()
    const copy: EmailBlock = { ...blocks[index], id: newId }
    // The source block's still-unsaved image (its `url` is a blob: preview, not a real one
    // yet) needs its own independent blob: URL for the duplicate — sharing the string would
    // mean removing either block revokes it out from under the other one.
    const sourcePending = pendingUploads.current.get(id)
    if (sourcePending) {
      const blobUrl = URL.createObjectURL(sourcePending.file)
      pendingUploads.current.set(newId, { blockId: newId, blobUrl, file: sourcePending.file })
      ;(copy as Extract<EmailBlock, { type: "image" }>).url = blobUrl
    }
    onChange([...blocks.slice(0, index + 1), copy, ...blocks.slice(index + 1)])
  }

  useImperativeHandle(ref, () => ({
    resolvePendingUploads: async () => {
      if (pendingUploads.current.size === 0) return blocks
      const uploaded = await Promise.all(
        [...pendingUploads.current.values()].map(async ({ blockId, blobUrl, file }) => {
          const fd = new FormData()
          fd.append("file", file)
          fd.append("prefix", "email-block-image")
          const res = await fetch("/api/upload", { method: "POST", body: fd })
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "upload failed")
          const { url } = (await res.json()) as { url: string }
          URL.revokeObjectURL(blobUrl)
          pendingUploads.current.delete(blockId)
          return [blockId, url] as const
        }),
      )
      const resolvedUrls = new Map(uploaded)
      return blocks.map(b => (b.type === "image" && resolvedUrls.has(b.id) ? { ...b, url: resolvedUrls.get(b.id)! } : b))
    },
    getPreviewBlocks: async () => {
      if (pendingUploads.current.size === 0) return blocks
      const encoded = await Promise.all(
        [...pendingUploads.current.values()]
          // Base64 runs ~33% larger than the source file, and this data: URI travels inside
          // the preview request's JSON body — Vercel Functions cap that at 4.5 MB total, well
          // under what ImageUpload's own 4 MB file limit could produce once encoded. Above
          // this, the block is left as its blob: URL (silently broken in the preview iframe,
          // same as before this fix) rather than risking the whole preview request failing —
          // it still uploads and previews normally once actually saved.
          .filter(({ file }) => file.size <= 3 * 1024 * 1024)
          .map(async ({ blockId, file }) => {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload  = () => resolve(reader.result as string)
              reader.onerror = () => reject(reader.error)
              reader.readAsDataURL(file)
            })
            return [blockId, dataUrl] as const
          }),
      )
      const dataUrls = new Map(encoded)
      return blocks.map(b => (b.type === "image" && dataUrls.has(b.id) ? { ...b, url: dataUrls.get(b.id)! } : b))
    },
  }))

  // The block order IS the render order (renderBlocksToHtml just maps over the array) —
  // moving a card is the whole reorder, nothing else needs to stay in sync.
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = blocks.findIndex(b => b.id === active.id)
    const to   = blocks.findIndex(b => b.id === over.id)
    if (from === -1 || to === -1) return
    onChange(arrayMove(blocks, from, to))
  }

  return (
    <div className="space-y-3">
      {blocks.length === 0 ? (
        <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {blocks.map(block => (
                <SortableBlockCard
                  key={block.id}
                  id={block.id}
                  dragLabel={t("dragHandle")}
                  duplicateLabel={t("duplicate")}
                  removeLabel={t("remove")}
                  onDuplicate={() => duplicateBlock(block.id)}
                  onRemove={() => removeBlock(block.id)}
                >
                  {block.type === "text" && (
                    <div className="space-y-2">
                      <RichTextEditor
                        value={block.html}
                        onChange={html => updateBlock(block.id, { html })}
                        minHeight="90px"
                        placeholder={t("textPlaceholder")}
                      />
                      <VariableTokenChips tokens={variables} />
                    </div>
                  )}

                  {block.type === "image" && (
                    <div className="space-y-2">
                      <ImageUpload
                        value={block.url || undefined}
                        onChange={url => {
                          // Only ever fires "" here (the "Retirer" click) in lazy mode — a new
                          // pick goes through onFilePending below instead. Clears whatever was
                          // pending for this block rather than leaving its blob: URL to leak
                          // until the editor unmounts.
                          if (url === "") {
                            const pending = pendingUploads.current.get(block.id)
                            if (pending) { URL.revokeObjectURL(pending.blobUrl); pendingUploads.current.delete(block.id) }
                          }
                          updateBlock(block.id, { url })
                        }}
                        prefix="email-block-image"
                        aspectRatio="wide"
                        lazy
                        onFilePending={(blobUrl, file) => handleFilePending(block.id, blobUrl, file)}
                      />
                      <FormField
                        label={t("imageLink")}
                        value={block.linkUrl ?? ""}
                        onChange={e => updateBlock(block.id, { linkUrl: e.target.value })}
                        onBlur={e => { const normalized = normalizeHref(e.target.value); if (normalized !== (block.linkUrl ?? "")) updateBlock(block.id, { linkUrl: normalized }) }}
                        placeholder="https://…"
                      />
                    </div>
                  )}

                  {block.type === "button" && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <FormField
                          label={t("buttonLabel")}
                          value={block.label}
                          onChange={e => updateBlock(block.id, { label: e.target.value })}
                          placeholder={t("buttonLabelPlaceholder")}
                        />
                        <FormField
                          label={t("buttonUrl")}
                          value={block.url}
                          onChange={e => updateBlock(block.id, { url: e.target.value })}
                          onBlur={e => { const normalized = normalizeHref(e.target.value); if (normalized !== block.url) updateBlock(block.id, { url: normalized }) }}
                          placeholder="https://…"
                          hint={t("urlHint")}
                        />
                      </div>
                      <div className="flex gap-2">
                        <ColorField
                          label={t("buttonColor")}
                          value={block.color ?? DEFAULT_BUTTON_COLOR}
                          onChange={color => updateBlock(block.id, { color })}
                          className="w-28"
                        />
                        <ColorField
                          label={t("buttonTextColor")}
                          // Falls back to the same auto-contrast renderButton() itself uses,
                          // so this never shows a color different from what would actually be
                          // sent until the admin deliberately overrides it.
                          value={block.textColor ?? (isColorDark(block.color ?? DEFAULT_BUTTON_COLOR) ? "#ffffff" : "#111827")}
                          onChange={textColor => updateBlock(block.id, { textColor })}
                          className="w-28"
                        />
                      </div>
                    </div>
                  )}

                  {block.type === "divider" && (
                    <div className="flex h-9 items-center">
                      <hr className="w-full border-border" />
                    </div>
                  )}
                </SortableBlockCard>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => addBlock("text")}>
          <TextTIcon className="mr-1.5 size-4" /> {t("addText")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addBlock("image")}>
          <ImageIcon className="mr-1.5 size-4" /> {t("addImage")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addBlock("button")}>
          <CursorClickIcon className="mr-1.5 size-4" /> {t("addButton")}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => addBlock("divider")}>
          <MinusIcon className="mr-1.5 size-4" /> {t("addDivider")}
        </Button>
      </div>
    </div>
  )
}
