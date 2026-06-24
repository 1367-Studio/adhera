"use client"

import { useState, useEffect, useRef } from "react"
import dynamic from "next/dynamic"
import { MapPinIcon, LoaderCircleIcon, XCircleIcon, ExternalLinkIcon } from "lucide-react"
import { cn } from "@/lib/utils"

const MapPickerInner = dynamic(
  () => import("./map-picker").then(m => m.MapPickerInner),
  { ssr: false, loading: () => <div style={{ height: "200px" }} className="w-full rounded-xl bg-muted animate-pulse" /> },
)

interface NominatimResult {
  place_id: number
  display_name: string
  lat: string
  lon: string
  address: {
    house_number?: string
    road?: string
    city?: string
    town?: string
    village?: string
    municipality?: string
    postcode?: string
  }
}

function formatAddress(r: NominatimResult): string {
  const a = r.address
  const street = [a.house_number, a.road].filter(Boolean).join(" ")
  const city   = a.city ?? a.town ?? a.village ?? a.municipality ?? ""
  const parts  = [street, a.postcode, city].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : r.display_name.split(",").slice(0, 3).join(",").trim()
}

interface LocationPickerProps {
  label?: string
  address: string
  lat?: number
  lng?: number
  onChange: (vals: { address: string; lat?: number; lng?: number }) => void
  error?: string
}

export function LocationPicker({ label = "Lieu", address, lat, lng, onChange, error }: LocationPickerProps) {
  const [query, setQuery]         = useState(address)
  const [results, setResults]     = useState<NominatimResult[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen]           = useState(false)
  const debounceRef               = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef              = useRef<HTMLDivElement>(null)

  useEffect(() => { setQuery(address) }, [address])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [])

  async function search(q: string) {
    if (q.length < 3) { setResults([]); setOpen(false); return }
    setSearching(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`,
        { headers: { "Accept-Language": "fr" } },
      )
      const data: NominatimResult[] = await res.json()
      setResults(data)
      setOpen(data.length > 0)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  function handleInput(val: string) {
    setQuery(val)
    onChange({ address: val, lat: undefined, lng: undefined })
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(val), 400)
  }

  function handleSelect(r: NominatimResult) {
    const formatted = formatAddress(r)
    const newLat    = parseFloat(r.lat)
    const newLng    = parseFloat(r.lon)
    setQuery(formatted)
    setResults([])
    setOpen(false)
    onChange({ address: formatted, lat: newLat, lng: newLng })
  }

  function handleMapPin(newLat: number, newLng: number) {
    onChange({ address: query, lat: newLat, lng: newLng })
    fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${newLat}&lon=${newLng}&format=json&addressdetails=1`,
      { headers: { "Accept-Language": "fr" } },
    )
      .then(r => r.json())
      .then((data: NominatimResult) => {
        const formatted = formatAddress(data)
        setQuery(formatted)
        onChange({ address: formatted, lat: newLat, lng: newLng })
      })
      .catch(() => {})
  }

  function handleClear() {
    setQuery("")
    setResults([])
    setOpen(false)
    onChange({ address: "", lat: undefined, lng: undefined })
  }

  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-foreground">{label}</label>}
      <div ref={containerRef} className="space-y-2">
        {/* Autocomplete input */}
        <div className="relative">
          <MapPinIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={e => handleInput(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            placeholder="Salle des fêtes, 12 rue de la Paix, Paris…"
            className={cn(
              "w-full rounded-md border border-input bg-background pl-9 pr-9 py-2 text-sm outline-none focus:ring-1 focus:ring-ring",
              error && "border-destructive focus:ring-destructive",
            )}
          />
          {searching ? (
            <LoaderCircleIcon className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground animate-spin pointer-events-none" />
          ) : query ? (
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XCircleIcon className="size-4" />
            </button>
          ) : null}

          {open && results.length > 0 && (
            <ul className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg overflow-hidden">
              {results.map(r => (
                <li key={r.place_id}>
                  <button
                    type="button"
                    onMouseDown={() => handleSelect(r)}
                    className="w-full px-3 py-2.5 text-left text-sm hover:bg-accent flex items-start gap-2"
                  >
                    <MapPinIcon className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <span className="line-clamp-2 text-xs">{r.display_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Map */}
        <div className="overflow-hidden rounded-xl border border-input">
          <MapPickerInner lat={lat} lng={lng} onPin={handleMapPin} />
        </div>

        {/* Coords + OSM link */}
        {lat != null && lng != null && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-green-500" />
            {lat.toFixed(5)}, {lng.toFixed(5)}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-0.5 inline-flex items-center gap-0.5 underline hover:text-foreground"
            >
              Voir sur Google Maps <ExternalLinkIcon className="size-3" />
            </a>
          </p>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
