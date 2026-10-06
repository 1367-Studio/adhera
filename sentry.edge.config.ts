// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://d649c015dceb054421a637bc641b4176@o4512151865851904.ingest.de.sentry.io/4512151871488080",

  // "production" / "preview" on Vercel, "development" locally — keeps local tests out of the
  // production Issues list (filter by environment in Sentry).
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  // Every request traced locally; 10% in production, where full tracing gets expensive.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,

  dataCollection: {
    // Personal data (names, emails, amounts...) must never reach a third-party service —
    // see reportError() in src/lib/monitoring.ts for the manual PII-minimization discipline
    // this is meant to back up at the SDK level.
    userInfo: false,
    httpBodies: [],
  },
});
