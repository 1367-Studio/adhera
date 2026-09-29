import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.register")
  return { title: t("pageTitle") }
}

// Self-registration is disabled portal-wide (see PortalLoginForm, which no longer links
// here) — new members always go through an admin-created invite or a membership form.
// Kept as a redirect, not a 404, so old bookmarks/emails still land somewhere useful.
export default async function PortalRegisterPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(`/portal/${slug}/login`)
}
