export type RsvpStatus = "CONFIRME" | "PROVAVEL" | "INCERTO" | "ABSENT" | "LISTA_ESPERA"

export type RsvpCounts = { CONFIRME: number; PROVAVEL: number; INCERTO: number; ABSENT: number; LISTA_ESPERA: number }

export type EvenementTicketType = { id: string; label: string; price: string; remaining: number | null; full: boolean }

// Shape returned by the portal API, both by the list (`/api/portal/evenements`) and by
// the detail endpoint (`/api/portal/evenements/[id]`).
export type Evenement = {
  id:             string
  title:          string
  description:    string | null
  imageUrl:       string | null
  date:           string
  endDate:        string | null
  location:       string | null
  lat:            number | null
  lng:            number | null
  price:          string | null
  capacity:       number | null
  // Set when the manager closed online registrations early (see Evenement.registrationsClosedAt).
  registrationsClosedAt: string | null
  ticketTypes:    EvenementTicketType[]
  participations: { id: string; present: boolean; rsvp: RsvpStatus | null; ticketPaidAt: string | null; avis: { id: string } | null }[]
  partySize:      number
  rsvpCounts:     RsvpCounts
  confirmedCount: number
}

// Ticket types (when the event has any) drive the paid-section UI regardless of whether
// every tier happens to be 0€ — the admin explicitly set up a choice, so show it.
export function evenementHasFee(evenement: Evenement): boolean {
  return evenement.ticketTypes.length > 0 || (evenement.price != null && Number(evenement.price) > 0)
}
