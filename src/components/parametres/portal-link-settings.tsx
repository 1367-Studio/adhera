"use client"

import { useState, useRef } from "react"
import { ClipboardIcon, CheckIcon, ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"

export function PortalLinkSettings({ slug }: { slug: string }) {
  const [copied, setCopied]       = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const portalUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/portal/${slug}`
      : `/portal/${slug}`

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(portalUrl)
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopyFailed(true)
      inputRef.current?.select()
    }
  }

  function handleOpen() {
    window.open(`${portalUrl}/login`, "_blank", "noopener,noreferrer")
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Lien du portail membre</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Partagez ce lien avec vos membres pour qu&apos;ils puissent accéder à leur espace.
        </p>
      </div>

      <input
        ref={inputRef}
        readOnly
        value={portalUrl}
        onFocus={(e) => e.target.select()}
        className="w-full rounded-xl border bg-muted px-4 py-3 font-mono text-sm break-all outline-none cursor-text"
      />

      {copyFailed && (
        <p className="text-xs text-amber-600">
          Copie automatique indisponible — sélectionnez le texte ci-dessus et copiez manuellement.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleCopy}>
          {copied ? (
            <>
              <CheckIcon className="mr-1.5 size-4 text-emerald-600" />
              <span className="text-emerald-600">Copié !</span>
            </>
          ) : (
            <>
              <ClipboardIcon className="mr-1.5 size-4" />
              Copier
            </>
          )}
        </Button>

        <Button variant="outline" size="sm" onClick={handleOpen}>
          <ArrowSquareOutIcon className="mr-1.5 size-4" />
          Ouvrir
        </Button>
      </div>
    </div>
  )
}
