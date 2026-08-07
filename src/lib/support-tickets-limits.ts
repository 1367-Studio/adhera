// Shared by the Zod schemas in the API routes (src/app/api/support-tickets/*,
// src/app/api/backoffice/support-tickets/*) and the client-side character counters
// (src/components/support/*) — one source of truth so a limit change can't quietly drift
// between what the server enforces and what the UI tells the user.
export const SUPPORT_TICKET_SUBJECT_MAX_LENGTH = 200
export const SUPPORT_TICKET_BODY_MAX_LENGTH    = 10_000
