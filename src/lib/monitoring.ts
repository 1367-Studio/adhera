import * as Sentry from "@sentry/nextjs"

// Which part of the product failed — becomes the `area` tag in Sentry, so the Issues list can
// be filtered per domain ("everything Stripe", "everything AI").
export type MonitoringArea =
  | "stripe"
  | "payments"
  | "ai"
  | "email"
  | "storage"
  | "cron"
  | "webhook"
  | "portal"
  | "public"
  | "api"

type ReportErrorContext = {
  area:    MonitoringArea
  // Short, stable name of the operation ("checkout.create-session") — also a tag.
  action:  string
  // Ids only (associationId, evenementId, orderId…). Never names, emails, amounts typed by a
  // member or raw AI output: this goes to a third-party service.
  extra?:  Record<string, string | number | boolean | null | undefined>
}

// For a failure the code *handles* (catch → error response, toast, fallback). Sentry already
// reports unhandled throws on its own; a caught error is invisible to it unless reported here.
// Also logs, so it replaces the console.error that usually sat in the same catch.
export function reportError(error: unknown, { area, action, extra }: ReportErrorContext): void {
  console.error(`[${area}:${action}]`, error)
  Sentry.captureException(error, { tags: { area, action }, extra })
}
