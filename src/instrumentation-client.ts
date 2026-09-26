import * as Sentry from "@sentry/nextjs";
import { BASE_PATH } from "@/lib/env"

// Next's `basePath` (next.config.ts) rewrites <Link>, useRouter() and <Image> automatically,
// but NOT plain fetch() calls — the codebase has ~200 of them calling absolute paths like
// fetch("/api/..."). Runs once, before hydration, so it's in place before any data hook fires.
// Installed before Sentry.init so Sentry's fetch instrumentation wraps it and records the
// real, prefixed URL.
const originalFetch = window.fetch.bind(window)

window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith("/") && !input.startsWith(BASE_PATH + "/")) {
    return originalFetch(BASE_PATH + input, init)
  }
  return originalFetch(input, init)
}

// Sentry client setup — https://docs.sentry.io/platforms/javascript/guides/nextjs/
Sentry.init({
  dsn: "https://d649c015dceb054421a637bc641b4176@o4512151865851904.ingest.de.sentry.io/4512151871488080",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // "production" / "preview" on Vercel, "development" locally — keeps local tests out of the
  // production Issues list (filter by environment in Sentry).
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,

  // Every request traced locally; 10% in production, where full tracing gets expensive.
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  dataCollection: {
    // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
    // userInfo: false,
    // httpBodies: [],
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
