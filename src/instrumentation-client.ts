import { BASE_PATH } from "@/lib/env"

// Next's `basePath` (next.config.ts) rewrites <Link>, useRouter() and <Image> automatically,
// but NOT plain fetch() calls — the codebase has ~200 of them calling absolute paths like
// fetch("/api/..."). Runs once, before hydration, so it's in place before any data hook fires.
const originalFetch = window.fetch.bind(window)

window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith("/") && !input.startsWith(BASE_PATH + "/")) {
    return originalFetch(BASE_PATH + input, init)
  }
  return originalFetch(input, init)
}
