import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import type { SiteConfig, SiteSection } from "@/types/site-config"

// Feeds SitePreviewPanel the same real data [slug]/page.tsx's getSiteData() fetches for the
// public site — actualités, boutique products, and MembershipForm/DonationForm section
// bindings — so the admin preview can render the actual section components instead of a
// hand-mocked approximation. Deliberately NOT reusing /api/public/[slug]/* here: those routes
// 404 while sitePublished is still false or a module is off, which is exactly when a preview
// is most needed (an association mid-setup, before its first publish).
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { siteConfig: true, canIssueTaxReceipts: true },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const now = new Date()
  const [actualites, boutiqueProduits, membershipForms, donationForms, liveDonationFormCount] = await Promise.all([
    prisma.actualite.findMany({
      where:   { associationId, publishedAt: { not: null, lte: now }, recipientMode: "ALL" },
      orderBy: [{ pinned: "desc" }, { publishedAt: "desc" }],
      take:    20,
      select:  { id: true, title: true, content: true, imageUrl: true, pinned: true, publishedAt: true },
    }),
    prisma.boutiqueProduit.findMany({
      where:   { associationId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take:    20,
      select:  { id: true, name: true, imageUrl: true, variantes: { select: { price: true } } },
    }),
    prisma.membershipForm.findMany({
      where:  { associationId, status: "PUBLISHED", visibility: "SITE", siteSectionId: { not: null } },
      select: { slug: true, title: true, siteSectionId: true },
    }),
    prisma.donationForm.findMany({
      where:   { associationId, status: "PUBLISHED", visibility: "SITE", siteSectionId: { not: null } },
      // Same deterministic pick as the public site for legacy duplicates on one section.
      orderBy: { updatedAt: "desc" },
      select:  { slug: true, title: true, siteSectionId: true },
    }),
    prisma.donationForm.count({
      where: { associationId, status: { in: ["PUBLISHED", "ARCHIVED"] } },
    }),
  ])

  const membershipFormBySection: Record<string, { slug: string; title: string }> =
    Object.fromEntries(membershipForms.map(f => [f.siteSectionId as string, { slug: f.slug, title: f.title }]))
  const donationFormBySection: Record<string, { slug: string; title: string }> = {}
  for (const donationForm of donationForms) {
    const sectionId = donationForm.siteSectionId as string
    if (!donationFormBySection[sectionId]) donationFormBySection[sectionId] = { slug: donationForm.slug, title: donationForm.title }
  }

  const siteSections = (assoc.siteConfig as SiteConfig | null)?.sections ?? []
  const firstBoundMembershipForm = siteSections
    .filter((s): s is SiteSection & { type: "membership" } => s.type === "membership")
    .map(s => membershipFormBySection[s.id])
    .find(Boolean)

  return NextResponse.json({
    actualites: actualites.map(a => ({ ...a, publishedAt: a.publishedAt!.toISOString() })),
    boutiqueProduits,
    membershipFormBySection,
    donationFormBySection,
    // Decides whether an unbound "dons" section is hidden (true) or keeps the legacy generic
    // donation link (false) — see SiteDonsSection.
    usesDonationForms: liveDonationFormCount > 0,
    membershipCta:firstBoundMembershipForm ? { href: "#" } : null,
    canIssueTaxReceipts: assoc.canIssueTaxReceipts,
  })
})
