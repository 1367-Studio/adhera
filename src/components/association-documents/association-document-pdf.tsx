import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface AssociationDocumentPdfProps {
  fileUrl:          string
  fileName:         string | null
  // Names the embedded viewer for screen readers.
  documentTitle:    string
  openLabel:        string
  opensNewTabLabel: string
  // The public site keeps its own gray-* chrome instead of the app's theme tokens.
  tone?:            "app" | "public"
}

// The imported PDF of a legal document, as read in the member portal and on the public site.
export function AssociationDocumentPdf({
  fileUrl, fileName, documentTitle, openLabel, opensNewTabLabel, tone = "app",
}: AssociationDocumentPdfProps) {
  const isPublic = tone === "public"

  return (
    // Printing the page prints the written text; the PDF is printed from its own tab.
    <div className="space-y-4 print:hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button variant="outline" nativeButton={false} render={<a href={fileUrl} target="_blank" rel="noopener noreferrer" />}>
          <ArrowSquareOutIcon className="size-4" />
          {openLabel}
          <span className="sr-only">{opensNewTabLabel}</span>
        </Button>
        {fileName && (
          <span className={cn("min-w-0 truncate text-sm", isPublic ? "text-gray-500" : "text-muted-foreground")}>
            {fileName}
          </span>
        )}
      </div>

      {/* md and up only: mobile browsers render an inline PDF unreliably (first page only,
          or a blank frame), so small screens rely on the button above. h-[80vh] is a genuine
          layout requirement — a PDF page needs most of the viewport to be readable, and no
          spacing token is viewport-relative. */}
      {/* Open-parameters fragment: without it Chrome's viewer opens its thumbnail sidebar on
          any frame this wide and fits the whole page into what is left. navpanes=0 hides the
          sidebar, view=FitH fits the page width. Browsers that ignore the fragment (Safari)
          simply render their default. */}
      <iframe
        src={`${fileUrl}#navpanes=0&view=FitH`}
        title={documentTitle}
        className={cn("hidden h-[80vh] w-full rounded-lg border md:block", isPublic && "border-gray-200")}
      />
    </div>
  )
}
