import { APP_URL } from "@/lib/env"

// The absolute URL a member card's QR code encodes, and the only place that spelling lives:
// the card renderer, the PDF and any email pointing at a card must all agree with the route
// at src/app/carte/[token]/page.tsx, since a printed QR can't be corrected afterwards.
//
// APP_URL already carries the /app basePath — it is NEXTAUTH_URL minus its "/api/auth" tail
// (see src/lib/env.ts), i.e. "http://localhost:3000/app" locally — so nothing prepends
// BASE_PATH here, exactly like the event tickets' `${APP_URL}/billet/${ticketToken}`.
// Prepending it would produce /app/app/carte/… and every card ever printed would 404.
//
// Kept as short as the route allows ("/carte/" + a 22-char token): a QR code's density grows
// with the URL's length, and a dense code scans badly off a phone screen or a small print.
export function memberCardVerificationUrl(cardToken: string): string {
  return `${APP_URL}/carte/${cardToken}`
}
