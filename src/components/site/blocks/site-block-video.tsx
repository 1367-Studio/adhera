"use client"

import { useState } from "react"
import { PlayIcon } from "@phosphor-icons/react/dist/ssr"
import type { ComponentConfig } from "@puckeditor/core"
import { SiteEditingPlaceholder } from "@/components/site/blocks/site-block-editing-placeholder"
import { useSiteCookieConsent } from "@/components/site/site-cookie-consent"

// "Vidéo": a YouTube or Vimeo video, embedded from the link the volunteer copies from the
// browser address bar.

export type VideoBlockProps = {
  url:   string
  title: string
}

const YOUTUBE_VIDEO_ID_PATTERN = /^[\w-]{11}$/
const VIMEO_VIDEO_ID_PATTERN   = /^\d+$/

// Turns any usual YouTube / Vimeo link into its embed URL, or null when the link is not one:
// youtube.com/watch?v=…, youtube.com/shorts/…, youtube.com/embed/…, youtu.be/…,
// vimeo.com/123, vimeo.com/123/abcdef (unlisted), player.vimeo.com/video/123.
// YouTube goes through youtube-nocookie.com so no tracking cookie is set before playback.
export function toVideoEmbedUrl(rawUrl: string): string | null {
  const trimmedUrl = rawUrl.trim()
  if (!trimmedUrl) return null
  let parsedUrl: URL
  try {
    parsedUrl = new URL(/^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : `https://${trimmedUrl}`)
  } catch {
    return null
  }
  const hostname     = parsedUrl.hostname.replace(/^(www\.|m\.)/, "")
  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean)

  let youtubeVideoId: string | null = null
  if (hostname === "youtu.be") {
    youtubeVideoId = pathSegments[0] ?? null
  } else if (hostname === "youtube.com" || hostname === "youtube-nocookie.com") {
    if (pathSegments[0] === "watch") youtubeVideoId = parsedUrl.searchParams.get("v")
    else if (["shorts", "embed", "live", "v"].includes(pathSegments[0] ?? "")) youtubeVideoId = pathSegments[1] ?? null
  }
  if (youtubeVideoId) {
    return YOUTUBE_VIDEO_ID_PATTERN.test(youtubeVideoId)
      ? `https://www.youtube-nocookie.com/embed/${youtubeVideoId}`
      : null
  }

  if (hostname === "vimeo.com" || hostname === "player.vimeo.com") {
    const videoSegments = pathSegments[0] === "video" ? pathSegments.slice(1) : pathSegments
    const vimeoVideoId  = videoSegments[0]
    if (!vimeoVideoId || !VIMEO_VIDEO_ID_PATTERN.test(vimeoVideoId)) return null
    // Unlisted videos carry a privacy hash, either as a second path segment or as ?h=.
    const privacyHash = parsedUrl.searchParams.get("h") ?? videoSegments[1]
    const embedUrl    = new URL(`https://player.vimeo.com/video/${vimeoVideoId}`)
    if (privacyHash && /^[\da-f]+$/i.test(privacyHash)) embedUrl.searchParams.set("h", privacyHash)
    return embedUrl.toString()
  }
  return null
}

function videoProviderName(embedUrl: string): string {
  return embedUrl.includes("vimeo.com") ? "Vimeo" : "YouTube"
}

// Without cookie consent the iframe is not loaded at all (no request to YouTube / Vimeo): a
// click-to-load placeholder loads this one video, or accepts cookies for the whole site.
// Always loaded while editing, so the volunteer sees the real video.
function SiteVideoEmbed({ embedUrl, title, isEditing }: { embedUrl: string; title: string; isEditing: boolean }) {
  const { consent, accept }             = useSiteCookieConsent()
  const [isLoadedOnce, setIsLoadedOnce] = useState(false)
  const shouldLoadVideo                 = isEditing || consent === "accepted" || isLoadedOnce
  const frameStyle                      = { borderRadius: "var(--site-radius)", background: "var(--site-surface-muted)" }

  if (!shouldLoadVideo) {
    const providerName = videoProviderName(embedUrl)
    return (
      <div
        className="flex aspect-video w-full flex-col items-center justify-center gap-4 px-6 text-center text-sm"
        style={{ ...frameStyle, color: "var(--site-text-muted)" }}
      >
        <PlayIcon weight="fill" className="size-8" style={{ color: "var(--site-text)" }} aria-hidden="true" />
        <p className="max-w-md">
          Cette vidéo est hébergée par {providerName}. En la lançant, vous acceptez leurs cookies.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => setIsLoadedOnce(true)}
            aria-label={title.trim() ? `Charger la vidéo : ${title.trim()}` : undefined}
            className="inline-flex h-10 items-center justify-center px-5 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: "var(--site-primary)", color: "var(--site-primary-foreground)", borderRadius: "var(--site-radius)" }}
          >
            Charger la vidéo
          </button>
          <button
            type="button"
            onClick={accept}
            className="text-sm underline-offset-2 hover:underline"
            style={{ color: "var(--site-text)" }}
          >
            Tout accepter
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="aspect-video w-full overflow-hidden" style={frameStyle}>
      <iframe
        src={embedUrl}
        title={title.trim() || "Vidéo"}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
        className="block h-full w-full border-0"
      />
    </div>
  )
}

export const videoBlock: ComponentConfig<VideoBlockProps> = {
  label:  "Vidéo",
  fields: {
    url:   { type: "text", label: "Lien de la vidéo (YouTube ou Vimeo)" },
    title: { type: "text", label: "Titre de la vidéo (accessibilité)" },
  },
  defaultProps: {
    url:   "",
    title: "",
  },
  render: ({ url, title, puck }) => {
    const embedUrl = toVideoEmbedUrl(url ?? "")
    if (!embedUrl) {
      if (!puck.isEditing) return <></>
      return (
        <SiteEditingPlaceholder className="aspect-video">
          {url?.trim() ? "Ce lien n'est pas une vidéo YouTube ou Vimeo." : "Collez le lien d'une vidéo YouTube ou Vimeo."}
        </SiteEditingPlaceholder>
      )
    }
    return <SiteVideoEmbed embedUrl={embedUrl} title={title} isEditing={puck.isEditing} />
  },
}
