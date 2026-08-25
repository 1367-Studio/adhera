"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  CheckIcon, CopyIcon, DownloadSimpleIcon, PrinterIcon,
  ShareNetworkIcon, WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useBranding, useCurrentUser } from "@/lib/user-context"
import { BASE_PATH } from "@/lib/env"

// Le QR imprimé finit sur un flyer/une affiche : on le rend hors écran à une résolution
// bien supérieure à l'affichage (176px) pour que l'export PNG et l'impression restent
// nets. Un QR exporté à sa taille d'écran devient illisible une fois agrandi.
const EXPORT_SIZE  = 1024
const DISPLAY_SIZE = 176

export function DonShareCard() {
  const user     = useCurrentUser()
  const branding = useBranding()
  const slug     = user.associationSlug

  const exportRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  // navigator.share n'existe pas partout (Firefox desktop, Chrome sous Linux…). Lu via
  // useSyncExternalStore et non pendant le rendu : le snapshot serveur vaut false, donc
  // l'HTML serveur et le premier rendu client concordent (pas d'erreur d'hydratation),
  // et le bouton apparaît juste après si la plateforme le supporte.
  const canShare = useSyncExternalStore(subscribeNoop, () => !!navigator.share, () => false)

  useEffect(() => {
    if (!copied) return
    const id = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(id)
  }, [copied])

  // window.location.origin lu comme snapshot externe, pas pendant le rendu : React
  // utilise getServerSnapshot ("") pour le SSR *et* pour le rendu d'hydratation, donc
  // les deux concordent, puis re-rend avec l'origine réelle. Le lire directement
  // produirait un QR et une URL relatifs côté serveur, absolus côté client — soit une
  // erreur d'hydratation, soit pire : une mauvaise URL affichée puis remplacée.
  const origin = useSyncExternalStore(subscribeNoop, () => window.location.origin, () => "")
  const ready  = !!origin
  const donUrl = ready && slug ? `${origin}${BASE_PATH}/portal/${slug}/don` : ""

  // Même endpoint public que la page de don elle-même : évite d'imprimer 500 flyers
  // pointant vers un formulaire qui refusera les paiements faute de compte Stripe
  // connecté. staleTime élevé — la réponse coûte un appel Stripe non mis en cache côté
  // serveur (connectAccountChargesEnabled).
  const { data: publicInfo } = useQuery<{ paymentEnabled?: boolean; canIssueTaxReceipts?: boolean }>({
    queryKey:  ["public-don-info", slug],
    queryFn:   () => fetch(`${BASE_PATH}/api/public/${slug}/don`).then(r => r.ok ? r.json() : {}),
    enabled:   !!slug,
    staleTime: 5 * 60_000,
  })

  function exportCanvas(): HTMLCanvasElement | null {
    return exportRef.current?.querySelector("canvas") ?? null
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(donUrl)
      setCopied(true)
      toast.success("Lien copié")
    } catch {
      // clipboard exige un contexte sécurisé (https/localhost) — sans lui, mieux vaut
      // le dire que de laisser croire à une copie silencieuse.
      toast.error("Copie impossible — sélectionnez le lien manuellement.")
    }
  }

  function handleDownload() {
    const canvas = exportCanvas()
    if (!canvas) return toast.error("QR code indisponible.")
    const link = document.createElement("a")
    link.download = `don-${slug}.png`
    link.href     = canvas.toDataURL("image/png")
    link.click()
  }

  function handlePrint() {
    const canvas = exportCanvas()
    if (!canvas) return toast.error("QR code indisponible.")
    // Fenêtre dédiée plutôt que window.print() sur le dashboard : imprimer la page
    // entière obligerait à maintenir une feuille de style print pour tout le tableau.
    const win = window.open("", "_blank", "width=720,height=900")
    if (!win) return toast.error("Autorisez les fenêtres pop-up pour imprimer.")
    const title = branding?.name ?? "Faire un don"
    win.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title>
      <style>
        @page { margin: 16mm }
        body { font-family: system-ui, sans-serif; text-align: center; color: #111 }
        h1 { font-size: 20px; margin: 0 0 4px }
        p  { font-size: 13px; color: #555; margin: 0 0 24px }
        img { width: 260px; height: 260px }
        code { display: block; margin-top: 20px; font-size: 12px; color: #333; word-break: break-all }
      </style></head><body>
      <h1>${escapeHtml(title)}</h1>
      <p>Scannez ce QR code pour faire un don</p>
      <img src="${canvas.toDataURL("image/png")}" alt="" />
      <code>${escapeHtml(donUrl)}</code>
      <script>window.onload = function () { window.focus(); window.print() }<\/script>
      </body></html>`)
    win.document.close()
  }

  async function handleShare() {
    const title = branding?.name ? `Faire un don — ${branding.name}` : "Faire un don"
    const canvas = exportCanvas()

    // Partager l'image du QR quand la plateforme le permet ; sinon le lien seul.
    if (canvas) {
      try {
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/png"))
        if (blob) {
          const file = new File([blob], `don-${slug}.png`, { type: "image/png" })
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ title, text: donUrl, files: [file] })
            return
          }
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return   // partage annulé par l'utilisateur
      }
    }

    try {
      await navigator.share({ title, url: donUrl })
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") toast.error("Partage impossible.")
    }
  }

  if (!slug) return null

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* Le QR a besoin d'un fond blanc dans les deux thèmes pour rester scannable. */}
        <div className="mx-auto shrink-0 rounded-lg border bg-white p-3 sm:mx-0">
          {ready
            ? <QRCodeSVG value={donUrl} size={DISPLAY_SIZE} />
            : <div style={{ width: DISPLAY_SIZE, height: DISPLAY_SIZE }} />}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Page de don publique</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Affiches, flyers, réseaux sociaux — ce lien fonctionne sans compte.
              {publicInfo?.canIssueTaxReceipts && " Le reçu fiscal est envoyé automatiquement."}
            </p>
          </div>

          <div className="flex gap-2">
            <Input readOnly value={donUrl} onFocus={e => e.currentTarget.select()} className="font-mono text-xs" />
            <Button variant="outline" size="icon" disabled={!ready} onClick={handleCopy} title="Copier le lien" aria-label="Copier le lien">
              {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!ready} onClick={handleDownload}>
              <DownloadSimpleIcon className="mr-1.5 size-3.5" />
              Télécharger
            </Button>
            <Button variant="outline" size="sm" disabled={!ready} onClick={handlePrint}>
              <PrinterIcon className="mr-1.5 size-3.5" />
              Imprimer
            </Button>
            {canShare && (
              <Button variant="outline" size="sm" disabled={!ready} onClick={handleShare}>
                <ShareNetworkIcon className="mr-1.5 size-3.5" />
                Partager
              </Button>
            )}
          </div>

          {publicInfo && !publicInfo.paymentEnabled && (
            <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <WarningCircleIcon className="mt-0.5 size-3.5 shrink-0" />
              Les paiements en ligne ne sont pas encore actifs : configurez Stripe dans
              Paramètres avant de diffuser ce lien.
            </p>
          )}
        </div>
      </div>

      {/* Rendu hors écran, uniquement pour l'export PNG/impression/partage en haute
          résolution. Positionné hors cadre plutôt que display:none — un canvas masqué
          reste dessiné, mais rester dans le flux évite toute surprise selon le navigateur. */}
      <div
        ref={exportRef}
        aria-hidden
        style={{ position: "absolute", left: -99999, top: 0, pointerEvents: "none" }}
      >
        {ready && <QRCodeCanvas value={donUrl} size={EXPORT_SIZE} marginSize={2} />}
      </div>
    </div>
  )
}

const subscribeNoop = () => () => {}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ))
}
