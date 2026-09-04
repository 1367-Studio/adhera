"use client"

import { useEffect, useRef } from "react"
import "leaflet/dist/leaflet.css"
import L from "leaflet"

const FRANCE_CENTER: [number, number] = [46.2276, 2.2137]

const pinIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;background:#3b82f6;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.35)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

interface MapPickerProps {
  lat?: number
  lng?: number
  onPin: (lat: number, lng: number) => void
}

export function MapPickerInner({ lat, lng, onPin }: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<L.Map | null>(null)
  const markerRef    = useRef<L.Marker | null>(null)
  const mounted      = useRef(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    // React 18/19 dev StrictMode mounts every component twice (mount → cleanup → mount) to
    // surface exactly this kind of bug: Leaflet stamps a `_leaflet_id` on the container on
    // first init, and `map.remove()` doesn't always clear it in time for the second
    // near-instant re-init on the SAME DOM node, which otherwise leaves Leaflet's internal
    // size/transform state corrupted (observed as flyTo throwing "Invalid LatLng object:
    // (NaN, NaN)" even though `lat`/`lng` themselves were always valid numbers).
    const stale = containerRef.current as HTMLDivElement & { _leaflet_id?: number }
    if (stale._leaflet_id) delete stale._leaflet_id

    const center: [number, number] = lat && lng ? [lat, lng] : FRANCE_CENTER
    const zoom = lat && lng ? 14 : 5

    const map = L.map(containerRef.current, { center, zoom })
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    if (lat && lng) {
      const marker = L.marker([lat, lng], { icon: pinIcon, draggable: true }).addTo(map)
      marker.on("dragend", () => {
        const pos = marker.getLatLng()
        onPin(pos.lat, pos.lng)
      })
      markerRef.current = marker
    }

    map.on("click", (e) => {
      const { lat: clickLat, lng: clickLng } = e.latlng
      if (markerRef.current) {
        markerRef.current.setLatLng([clickLat, clickLng])
      } else {
        const m = L.marker([clickLat, clickLng], { icon: pinIcon, draggable: true }).addTo(map)
        m.on("dragend", () => {
          const pos = m.getLatLng()
          onPin(pos.lat, pos.lng)
        })
        markerRef.current = m
      }
      onPin(clickLat, clickLng)
    })

    mapRef.current = map
    mounted.current = true

    // Leaflet measures its container at construction time — inside a container that's
    // mid-height-animation (e.g. a collapsed accordion panel just opening) or briefly
    // display:none, it locks in a wrong/zero size and only ever renders a partial tile
    // grid (visible as gray gaps) until something nudges it. A ResizeObserver catches
    // every subsequent size change, not just the first one, so this self-heals regardless
    // of what's animating the container.
    const resizeObserver = new ResizeObserver(() => map.invalidateSize())
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current  = null
      markerRef.current = null
      mounted.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mounted.current || !mapRef.current) return
    if (lat == null || lng == null) return
    // Also reject NaN, not just null/undefined — see the mount effect's _leaflet_id comment
    // for how a NaN could reach here even when the lat/lng props themselves were always
    // real numbers.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    try {
      mapRef.current.flyTo([lat, lng], 14, { duration: 0.8 })
    } catch {
      // React 18/19 dev StrictMode's mount→cleanup→mount cycle (see the mount effect's
      // _leaflet_id comment) can still leave Leaflet's internal projection state
      // momentarily broken even with valid lat/lng and a cleared _leaflet_id — flyTo's
      // animated path throws "Invalid LatLng object" from ITS OWN internal computation in
      // that case, not from these arguments. setView (no animation, no easing math) is the
      // safe fallback; dev-only artifact, never observed outside StrictMode's double-invoke.
      mapRef.current.setView([lat, lng], 14)
    }
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng])
    } else {
      const m = L.marker([lat, lng], { icon: pinIcon, draggable: true }).addTo(mapRef.current)
      m.on("dragend", () => {
        const pos = m.getLatLng()
        onPin(pos.lat, pos.lng)
      })
      markerRef.current = m
    }
  }, [lat, lng]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={containerRef} style={{ height: "200px", width: "100%", borderRadius: "0.75rem", zIndex: 0 }} />
  )
}
