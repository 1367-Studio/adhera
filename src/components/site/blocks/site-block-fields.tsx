"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { AutoField, FieldLabel, type CustomField, type Fields } from "@puckeditor/core"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { MAX_FUNCTION_UPLOAD_BYTES } from "@/lib/upload-limits"
import { useSitePuckMetadata } from "@/components/site/puck/use-site-puck-metadata"

// Reusable Puck fields for the site builder blocks.

export const YES_NO_OPTIONS = [
  { label: "Oui", value: true },
  { label: "Non", value: false },
]

// Same Oui/Non control as a plain `{ type: "radio" }` field, plus a contextual warning when
// "Oui" is picked but nothing will actually make the button appear: the header's "Adhérer"
// link only renders once a MembershipForm is PUBLISHED and bound to a section of this site
// (see membershipCta in site-navbar.tsx/[slug]/page.tsx) — without that, the toggle silently
// does nothing, which is confusing on its own.
function HeaderShowRegisterControl({
  field, value, onChange, readOnly, id,
}: { field: CustomField<boolean | undefined>; value: boolean | undefined; onChange: (value: boolean | undefined) => void; readOnly?: boolean; id?: string }) {
  const metadata          = useSitePuckMetadata()
  const showNoFormWarning = value === true && metadata !== null && metadata.membershipCta === null

  return (
    <FieldLabel label={field.label ?? "Bouton « Adhérer »"}>
      <AutoField field={{ type: "radio", options: YES_NO_OPTIONS }} value={value} onChange={onChange} readOnly={readOnly} id={id} />
      {showNoFormWarning && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Aucun formulaire d&apos;adhésion publié n&apos;est encore lié à une section de ce site — le bouton ne s&apos;affichera pas tant que ce n&apos;est pas fait.{" "}
          <Link href="/dashboard/adhesions" className="underline hover:text-foreground">
            Gérer les formulaires d&apos;adhésion
          </Link>
        </p>
      )}
    </FieldLabel>
  )
}

export function headerShowRegisterField(): CustomField<boolean | undefined> {
  return {
    type:   "custom",
    label:  "Bouton « Adhérer »",
    render: ({ field, value, onChange, readOnly, id }) => (
      <HeaderShowRegisterControl field={field} value={value} onChange={onChange} readOnly={readOnly} id={id} />
    ),
  }
}

export function colorField<ColorValue extends string | undefined>(label: string): CustomField<ColorValue> {
  return {
    type:  "custom",
    label,
    render: ({ field, value, onChange, readOnly, id }) => (
      <FieldLabel label={field.label ?? label}>
        <input
          id={id}
          type="color"
          value={value || "#ffffff"}
          disabled={readOnly}
          onChange={event => onChange(event.target.value as ColorValue)}
        />
      </FieldLabel>
    ),
  }
}

// Same R2 prefix for every image the site builder uploads.
const SITE_IMAGE_UPLOAD_PREFIX = "site"

function SiteImageUploadField({
  label, value, onChange, readOnly,
}: { label: string; value: string; onChange: (imageUrl: string) => void; readOnly?: boolean }) {
  const fileInputRef                = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)

  // Uploaded as soon as it is picked (not on save like the old builder): the stored value is
  // always a real URL, so the editor never has to swap blob: URLs inside the page data.
  async function uploadImage(imageFile: File) {
    if (imageFile.size > MAX_FUNCTION_UPLOAD_BYTES) {
      toast.error("Image trop volumineuse (4 Mo maximum).")
      return
    }
    setIsUploading(true)
    try {
      const uploadBody = new FormData()
      uploadBody.append("file", imageFile)
      uploadBody.append("prefix", SITE_IMAGE_UPLOAD_PREFIX)
      const uploadResponse = await fetch("/api/upload", { method: "POST", body: uploadBody })
      const uploadResult   = await uploadResponse.json().catch(() => ({}))
      if (!uploadResponse.ok || !uploadResult.url) {
        toast.error(uploadResult.error ?? "L'envoi de l'image a échoué.")
        return
      }
      onChange(uploadResult.url as string)
    } catch {
      toast.error("L'envoi de l'image a échoué.")
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <FieldLabel label={label}>
      <div className="flex flex-col gap-2">
        {value && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="h-24 w-full rounded-md border object-cover" />
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={readOnly || isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? "Envoi…" : value ? "Remplacer" : "Choisir une image"}
          </Button>
          {value && (
            <Button type="button" variant="ghost" size="sm" disabled={readOnly || isUploading} onClick={() => onChange("")}>
              Retirer
            </Button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={event => {
            const pickedFile = event.target.files?.[0]
            if (pickedFile) void uploadImage(pickedFile)
          }}
        />
      </div>
    </FieldLabel>
  )
}

export function imageField<ImageValue extends string | undefined = string>(label: string): CustomField<ImageValue> {
  return {
    type:  "custom",
    label,
    render: ({ field, value, onChange, readOnly }) => (
      <SiteImageUploadField
        label={field.label ?? label}
        value={value ?? ""}
        onChange={imageUrl => onChange(imageUrl as ImageValue)}
        readOnly={readOnly}
      />
    ),
  }
}

// A button/link: label + destination. Internal destinations are site-relative ("/evenements").
export type SiteLink = { label: string; href: string }

export const SITE_LINK_FIELDS: Fields<SiteLink> = {
  label: { type: "text", label: "Texte" },
  href:  { type: "text", label: "Lien (https://… ou /page)" },
}
