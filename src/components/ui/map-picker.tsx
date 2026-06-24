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

    return () => {
      map.remove()
      mapRef.current  = null
      markerRef.current = null
      mounted.current = false
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mounted.current || !mapRef.current) return
    if (lat == null || lng == null) return
    mapRef.current.flyTo([lat, lng], 14, { duration: 0.8 })
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
