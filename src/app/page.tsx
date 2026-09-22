import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { resolveAssociationSlugByHost } from "@/lib/custom-domain-lookup"

// A verified custom domain's root request never reaches src/proxy.ts: Vercel's own
// vercel.json rewrite (bare "/" -> "/app/") happens at the platform routing layer, and
// empirically (confirmed via production request logs) Next's middleware does NOT run
// against that rewritten destination the way it does for every other path — only this one
// root case is affected, every other custom-domain path proxies through normally. So the
// host lookup has to happen here instead, in the page Vercel's rewrite actually lands on.
export default async function HomePage() {
  const host = (await headers()).get("host")?.split(":")[0] ?? ""
  const slug = await resolveAssociationSlugByHost(host)
  redirect(slug ? `/${slug}` : "/dashboard")
}
