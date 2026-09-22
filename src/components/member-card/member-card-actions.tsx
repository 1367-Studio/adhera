"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { apiErrorMessage } from "@/lib/api-error"

// The two ways a card leaves the screen — download and print — behind one component, because
// they are the same action on two surfaces (the member's portal, a manager's modal) and must
// stay the same action: same labels, same route, same document. Only where a failure is shown
// differs, which is what `onError` is for.
//
// Renders a fragment rather than its own row: in the modal these are siblings of "Régénérer"
// inside DialogFooter and have to wrap with it, and the portal wraps them itself.

/** Used only if the server ever answers without a Content-Disposition of its own. */
const FALLBACK_PDF_FILENAME = "carte-membre.pdf"

interface MemberCardActionsProps {
  /** Route rendering this member's card as an A4 sheet; `disposition` is appended here. */
  pdfUrl:  string
  /** A toast on a page; an inline line inside a dialog, where a toast renders behind it. */
  onError: (message: string) => void
}

/** The portal route carries a ?membreId and the manager route doesn't — hence the separator. */
function withDisposition(pdfUrl: string, disposition: "attachment" | "inline"): string {
  return `${pdfUrl}${pdfUrl.includes("?") ? "&" : "?"}disposition=${disposition}`
}

export function MemberCardActions({ pdfUrl, onError }: MemberCardActionsProps) {
  // memberCard.portal.* on both surfaces on purpose: "Télécharger PDF" and "Imprimer" say the
  // same thing to a member and to a manager, and two keys would eventually drift apart.
  const translate       = useTranslations("memberCard.portal")
  // Only for the blocked-popup message: it belongs with the other print-time wording (the
  // cutting guide, the document title) rather than with the button labels.
  const translatePrint  = useTranslations("memberCard.print")
  const translateCommon = useTranslations("common")

  const [isDownloading, setIsDownloading] = useState(false)

  // Fetch-and-save rather than a plain link: a non-2xx answer (a membership that expired
  // between the page loading and the click) would otherwise replace the tab with raw JSON
  // instead of any legible feedback — same reasoning as downloadCotisationRecu in
  // membre-detail-view.tsx.
  async function handleDownload() {
    setIsDownloading(true)
    try {
      const response = await fetch(withDisposition(pdfUrl, "attachment"))
      if (!response.ok) {
        onError(await apiErrorMessage(response, translateCommon("genericError")))
        return
      }
      const blob      = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link      = document.createElement("a")
      link.href     = objectUrl
      link.download = response.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? FALLBACK_PDF_FILENAME
      link.click()
      URL.revokeObjectURL(objectUrl)
    } catch {
      onError(translateCommon("genericError"))
    } finally {
      setIsDownloading(false)
    }
  }

  // Printing opens the *same* PDF with disposition=inline and lets the browser's own viewer
  // print it. There is therefore exactly one renderer: what comes out of the printer is
  // byte-for-byte what the download contains, and the card's geometry (85,6 × 53,98 mm) is
  // fixed by the PDF rather than by a print stylesheet that a browser could reflow. The
  // alternative — writing the card into a popup and calling window.print() like
  // don-share-card.tsx — would mean a second layout to keep in step with layout.ts forever.
  //
  // Called synchronously from the click, so the browser treats it as user-initiated
  // navigation rather than a popup; a blocker that refuses anyway hands back null, which is
  // this path's only failure mode — hence a message naming the blocker and the download
  // button standing right next to it, rather than a generic error nobody can act on.
  // `noopener` is deliberately *not* passed: window.open returns null unconditionally with
  // it, which would make a refusal indistinguishable from a success, and the target is our
  // own origin.
  function handlePrint() {
    const printWindow = window.open(withDisposition(pdfUrl, "inline"), "_blank")
    if (!printWindow) onError(translatePrint("popupBlocked"))
  }

  return (
    <>
      <Button variant="outline" loading={isDownloading} onClick={handleDownload}>
        {translate("downloadPdf")}
      </Button>
      <Button variant="outline" onClick={handlePrint}>
        {translate("print")}
      </Button>
    </>
  )
}
