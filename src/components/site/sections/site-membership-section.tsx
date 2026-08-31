"use client"

import Link from "next/link"
import type { MembershipSection } from "@/types/site-config"
import { IdentificationCardIcon } from "@phosphor-icons/react/dist/ssr";

type Props = {
  section:     MembershipSection
  slug:        string
  color:       string
  // A MembershipForm published with visibility SITE and bound to this section — see
  // getSiteData in [slug]/page.tsx. No fallback form when null: the fixed-price inline
  // form this section used to show has been retired in favor of the MembershipForm flow.
  membershipForm: { slug: string; title: string } | null
}

export function SiteMembershipSection({ section, slug, color, membershipForm }: Props) {
  if (!membershipForm) return null
  return <SiteMembershipFormCta section={section} slug={slug} color={color} membershipForm={membershipForm} />
}

// Mirrors SiteDonsSection's CTA-card treatment — links out to the dedicated multi-tier
// public page instead of trying to inline a differently-shaped form here.
function SiteMembershipFormCta({ section, slug, color, membershipForm }: {
  section: MembershipSection
  slug:    string
  color:   string
  membershipForm: { slug: string; title: string }
}) {
  return (
    <section id="adhesion" className="py-16 px-4">
      <div className="max-w-md mx-auto text-center">
        <IdentificationCardIcon className="size-10 mx-auto mb-4" style={{ color }} />

        <h2 className="text-2xl font-bold mb-2 text-gray-900">{section.title || "Rejoindre l'association"}</h2>
        {section.body && <p className="text-gray-500 text-sm mb-8">{section.body}</p>}

        <Link
          href={`/${slug}/adhesion/${membershipForm.slug}`}
          className="inline-block w-full py-2.5 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: color }}
        >
          {membershipForm.title}
        </Link>
      </div>
    </section>
  )
}
