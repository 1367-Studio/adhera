"use client"

import { useEffect, useState } from "react"
import type { ComponentConfig } from "@puckeditor/core"
import { readSiteMetadata } from "@/components/site/blocks/site-block-types"
import { SiteEditingPlaceholder } from "@/components/site/blocks/site-block-editing-placeholder"
import { cn } from "@/lib/utils"

// "Carte": an OpenStreetMap map centred on an address.
//
// Limitation: the OSM embed (openstreetmap.org/export/embed.html) only takes coordinates, not an
// address, and no Google Maps embed is used anywhere in the app. The address is therefore
// geocoded in the visitor's browser through Nominatim (already used by the location picker),
// once per address and page load. If geocoding fails, the block falls back to a plain
// "Voir sur OpenStreetMap" search link.

export type MapHeight = "small" | "medium" | "large"

export type MapBlockProps = {
  address: string
  height:  MapHeight
}

const HEIGHT_CLASSES: Record<MapHeight, string> = {
  small:  "h-56",
  medium: "h-80",
  large:  "h-96 lg:h-128",
}

// Half-width of the visible area around the marker, in degrees (about a neighbourhood).
const MAP_SPAN_DEGREES = 0.006

type MapCoordinates = { latitude: number; longitude: number }

type GeocodingState = {
  address:     string
  coordinates: MapCoordinates | null
}

function buildEmbedUrl({ latitude, longitude }: MapCoordinates): string {
  const boundingBox = [
    longitude - MAP_SPAN_DEGREES, latitude - MAP_SPAN_DEGREES / 2,
    longitude + MAP_SPAN_DEGREES, latitude + MAP_SPAN_DEGREES / 2,
  ].join(",")
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(boundingBox)}&layer=mapnik&marker=${latitude},${longitude}`
}

function buildOpenStreetMapLink(address: string, coordinates: MapCoordinates | null): string {
  if (!coordinates) return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`
  const { latitude, longitude } = coordinates
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`
}

// The address typed in the block, or else the association's own address and city.
export function resolveMapAddress(blockAddress: string, metadataAddress: string | null, metadataCity: string | null): string {
  if (blockAddress.trim()) return blockAddress.trim()
  const address = metadataAddress?.trim() ?? ""
  const city    = metadataCity?.trim() ?? ""
  if (address && city && address.toLowerCase().includes(city.toLowerCase())) return address
  return [address, city].filter(Boolean).join(", ")
}

// Also used by the Contact block: one map implementation, no third-party cookies (no Google).
export function SiteMapEmbed({ address, height }: { address: string; height: MapHeight }) {
  const [geocodingState, setGeocodingState] = useState<GeocodingState | null>(null)

  useEffect(() => {
    const abortController = new AbortController()
    const searchUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&accept-language=fr`
    fetch(searchUrl, { signal: abortController.signal })
      .then(searchResponse => (searchResponse.ok ? searchResponse.json() : []))
      .then((searchResults: Array<{ lat: string; lon: string }>) => {
        const firstResult = searchResults[0]
        const coordinates = firstResult
          ? { latitude: Number(firstResult.lat), longitude: Number(firstResult.lon) }
          : null
        const hasValidCoordinates = coordinates && Number.isFinite(coordinates.latitude) && Number.isFinite(coordinates.longitude)
        setGeocodingState({ address, coordinates: hasValidCoordinates ? coordinates : null })
      })
      .catch(() => {
        if (!abortController.signal.aborted) setGeocodingState({ address, coordinates: null })
      })
    return () => abortController.abort()
  }, [address])

  const isGeocoding = geocodingState?.address !== address
  const coordinates = isGeocoding ? null : geocodingState.coordinates
  const frameStyle  = {
    borderRadius: "var(--site-radius)",
    background:   "var(--site-surface-muted)",
    border:       "1px solid var(--site-border)",
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={cn("w-full overflow-hidden", HEIGHT_CLASSES[height] ?? HEIGHT_CLASSES.medium)} style={frameStyle}>
        {coordinates ? (
          <iframe
            src={buildEmbedUrl(coordinates)}
            title={`Carte : ${address}`}
            loading="lazy"
            className="block h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm" style={{ color: "var(--site-text-muted)" }}>
            {isGeocoding ? "Chargement de la carte…" : address}
          </div>
        )}
      </div>
      <a
        href={buildOpenStreetMapLink(address, coordinates)}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start text-sm underline underline-offset-2"
      >
        Voir sur OpenStreetMap
      </a>
    </div>
  )
}

export const mapBlock: ComponentConfig<MapBlockProps> = {
  label:  "Carte",
  fields: {
    address: { type: "text", label: "Adresse (vide = adresse de l'association)" },
    height: {
      type:    "radio",
      label:   "Hauteur",
      options: [
        { label: "Petite",  value: "small" },
        { label: "Moyenne", value: "medium" },
        { label: "Grande",  value: "large" },
      ],
    },
  },
  defaultProps: {
    address: "",
    height:  "medium",
  },
  render: ({ address, height, puck }) => {
    const metadata      = readSiteMetadata(puck.metadata)
    const mapAddress    = resolveMapAddress(address ?? "", metadata.address, metadata.city)
    if (!mapAddress) {
      return puck.isEditing
        ? <SiteEditingPlaceholder>Saisissez une adresse, ou renseignez celle de l&apos;association dans Paramètres → Identité.</SiteEditingPlaceholder>
        : <></>
    }
    return <SiteMapEmbed address={mapAddress} height={height} />
  },
}
