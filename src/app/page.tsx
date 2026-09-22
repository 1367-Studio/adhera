import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { resolveAssociationSlugByHost } from "@/lib/custom-domain-lookup"
import PublicSitePage from "./[slug]/page"

// A verified custom domain's root request never reaches src/proxy.ts: Vercel's own
// vercel.json rewrite (bare "/" -> "/app/") happens at the platform routing layer, and
// empirically (confirmed via production request logs) Next's middleware does NOT run
// against that rewritten destination the way it does for every other path — only this one
// root case is affected, every other custom-domain path proxies through normally. So the
// host lookup has to happen here instead, in the page Vercel's rewrite actually lands on.
//
// Rendering PublicSitePage directly (rather than redirect(`/${slug}`)) matters: a redirect
// is a real HTTP 3xx the browser follows as a brand-new top-level request, which lands back
// on `/app/{slug}` — already `/app`-prefixed, so it skips vercel.json's rewrite AND still
// carries the same custom-domain Host header, so src/proxy.ts's own lookup fires again and
// prefixes the slug a *second* time (`/app/{slug}/{slug}`, a real 404 — this exact bug is
// what production testing caught). Rendering in place keeps the whole thing to one request,
// with the browser's address bar staying on the custom domain root as expected.
export default async function HomePage() {
  const host = (await headers()).get("host")?.split(":")[0] ?? ""
  const slug = await resolveAssociationSlugByHost(host)
  if (slug) return <PublicSitePage params={Promise.resolve({ slug })} />
  redirect("/dashboard")
}
