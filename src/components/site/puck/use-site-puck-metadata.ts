"use client"

import { useQuery } from "@tanstack/react-query"
import type { SitePuckMetadata } from "@/components/site/blocks/site-block-types"

// The live association data every site block reads (puck.metadata), shared by the editor and
// the full-page preview so both render exactly the same thing.

type AssociationData = {
  name: string; slug: string; city: string | null; country: string
  address: string | null; phone: string | null; contactEmail: string | null; website: string | null
}
type SitePreviewData = Omit<
  SitePuckMetadata,
  "associationName" | "slug" | "city" | "country" | "address" | "phone" | "contactEmail" | "website" | "events"
>

/** Null until every source has loaded. */
export function useSitePuckMetadata(): SitePuckMetadata | null {
  const associationQuery = useQuery<AssociationData>({
    queryKey: ["association"],
    queryFn:  () => fetch("/api/association").then(response => response.json()),
  })

  const eventsQuery = useQuery<SitePuckMetadata["events"]>({
    queryKey: ["evenements-site-preview"],
    queryFn:  () =>
      fetch("/api/evenements?upcoming=true")
        .then(response => response.json())
        .then((events: SitePuckMetadata["events"]) =>
          events.map(event => ({ ...event, price: event.price != null ? String(event.price) : null })),
        ),
  })

  const previewDataQuery = useQuery<SitePreviewData>({
    queryKey: ["site-preview-data"],
    queryFn:  () => fetch("/api/site-preview-data").then(response => response.json()),
  })

  if (!associationQuery.data || !previewDataQuery.data || eventsQuery.isPending) return null

  return {
    ...previewDataQuery.data,
    associationName: associationQuery.data.name,
    slug:            associationQuery.data.slug,
    city:            associationQuery.data.city,
    country:         associationQuery.data.country,
    address:         associationQuery.data.address,
    phone:           associationQuery.data.phone,
    contactEmail:    associationQuery.data.contactEmail,
    website:         associationQuery.data.website,
    events:          eventsQuery.data ?? [],
  }
}
