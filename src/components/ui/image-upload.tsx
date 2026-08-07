"use client"

import { useState, useRef } from "react"
import { ImageIcon, CircleNotchIcon, XIcon, UploadSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { toast } from "sonner"
import { cn } from "@/lib/utils"

interface ImageUploadProps {
  value?: string
  onChange: (url: string) => void
  prefix?: string
  aspectRatio?: "video" | "square" | "wide"
  className?: string
  /** When true, skips the immediate R2 upload. onChange receives a blob: URL for preview,
   *  and onFilePending is called with the File so the consumer can upload at save time. */
  lazy?: boolean
  onFilePending?: (blobUrl: string, file: File, prefix: string) => void
  /** Upload endpoint — defaults to the admin route. Pass "/api/portal/upload" for
   *  member-facing forms so the request goes through withPortalAuth instead of
   *  withAdminAuth. */
  uploadUrl?: string
  /** For small containers (avatar-sized squares, ~120px or less) where the full
   *  instructions/button labels don't fit — drops to icon-only, with the same
   *  text exposed as a title tooltip instead. */
  compact?: boolean
}

const RATIOS = {
  video:  "aspect-video",
  square: "aspect-square",
  wide:   "aspect-[3/1]",
}

export function ImageUpload({
  value,
  onChange,
  prefix = "adhera",
  aspectRatio = "video",
  className,
  lazy = false,
  onFilePending,
  uploadUrl = "/api/upload",
  compact = false,
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [dragging,  setDragging]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    if (file.size > 5 * 1024 * 1024) { toast.error("Image trop volumineuse (max 5 Mo)"); return }

    if (lazy) {
      const blobUrl = URL.createObjectURL(file)
      onFilePending?.(blobUrl, file, prefix)
      onChange(blobUrl)
      if (inputRef.current) inputRef.current.value = ""
      return
    }

    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("prefix", prefix)
      const res = await fetch(uploadUrl, { method: "POST", body: fd })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? "Erreur lors de l'upload")
        return
      }
      const { url } = await res.json()
      onChange(url)
    } catch {
      toast.error("Erreur lors de l'upload")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className={cn("relative group rounded-lg overflow-hidden", RATIOS[aspectRatio], className)}>
      {value ? (
        <>
          {/* Blurred background */}
          <img src={value} aria-hidden className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60" />
          {/* Full image */}
          <img
            src={value}
            alt=""
            className="absolute inset-0 w-full h-full object-contain z-10"
          />
          <div className={cn(
            "absolute inset-0 z-20 rounded-lg bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100",
            compact ? "flex-row gap-1" : "flex-col gap-2",
          )}>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              title={compact ? "Remplacer" : undefined}
              className={cn(
                "flex items-center gap-1.5 bg-background/90 text-foreground text-xs font-medium rounded-md hover:bg-background transition-colors",
                compact ? "p-1.5" : "px-3 py-1.5",
              )}
            >
              {uploading ? <CircleNotchIcon className="size-3.5 animate-spin" /> : <UploadSimpleIcon className="size-3.5" />}
              {!compact && "Remplacer"}
            </button>
            <button
              type="button"
              onClick={() => onChange("")}
              title={compact ? "Retirer" : undefined}
              className={cn(
                "flex items-center gap-1 bg-destructive/90 text-destructive-foreground text-xs font-medium rounded-md hover:bg-destructive transition-colors",
                compact ? "p-1.5" : "px-3 py-1.5",
              )}
            >
              <XIcon className="size-3.5" />
              {!compact && "Retirer"}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          disabled={uploading}
          title={compact ? "Glisser/cliquer pour ajouter une image (JPG, PNG, WebP, max 5 Mo)" : undefined}
          className={cn(
            "absolute inset-0 w-full h-full rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-2 p-2 text-center transition-colors",
            dragging
              ? "border-primary bg-primary/5 text-primary"
              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground hover:bg-muted/30",
          )}
        >
          {uploading ? (
            <CircleNotchIcon className="size-5 animate-spin" />
          ) : compact ? (
            <ImageIcon className="size-5" />
          ) : (
            <>
              <ImageIcon className="size-5" />
              <span className="text-xs font-medium">Glisser ou cliquer pour ajouter une image</span>
              <span className="text-[11px] opacity-60">JPG, PNG, WebP · max 5 Mo</span>
            </>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
      />
    </div>
  )
}
