import { getTranslations } from "next-intl/server"
import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { requiredDocuments } from "@/lib/legal/acceptance"
import { buildFicheMembreViergePdf, type FicheMembreViergeLabels } from "@/lib/pdf/fiche-membre-vierge"
import { hasAccess } from "@/lib/permissions"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { prisma } from "@/lib/prisma/client"


export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const [association, legalDocuments] = await Promise.all([
    prisma.association.findUnique({
      where:  { id: associationId },
      select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true },
    }),
    requiredDocuments(associationId),
  ])
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  // Same translations the "Ajouter manuellement" screen renders (membre-form.tsx) — resolved
  // here, server-side, from the requesting manager's own locale, and handed to the PDF builder
  // as finished strings so it never has to reach for a request context (see member-card's
  // pdf-response.ts for the same split). Pulled from the existing "membres.form.*" keys rather
  // than new ones, so the printed sheet and the screen can never drift apart in translation —
  // see FORM-109.
  const t = await getTranslations()
  const labels: FicheMembreViergeLabels = {
    title:    t("membres.fichePdf.title"),
    subtitle: t("membres.fichePdf.subtitle"),
    sections: {
      personalInfo:   t("membres.form.sections.personalInfo"),
      address:        t("membres.form.sections.address"),
      memberInfo:     t("membres.form.sections.memberInfo"),
      legalGuardian:  t("membres.form.sections.legalGuardian"),
      additionalInfo: t("membres.form.sections.additionalInfo"),
    },
    fields: {
      firstName:         t("membres.form.fields.firstName"),
      lastName:          t("membres.form.fields.lastName"),
      email:             t("membres.form.fields.email"),
      phone:             t("membres.form.fields.phone"),
      mobile:            t("membres.form.fields.mobile"),
      birthDate:         t("membres.form.fields.birthDate"),
      civilite:          t("membres.form.fields.civilite"),
      sexe:              t("membres.form.fields.sexe"),
      addressStreet:     t("address.street"),
      addressComplement: t("address.complement"),
      postalCode:        t("address.postalCode"),
      city:              t("address.city"),
      country:           t("address.country"),
      spokenLanguage:    t("membres.form.fields.spokenLanguage"),
      preferredLocale:   t("membres.form.fields.preferredLocale"),
      type:              t("membres.form.fields.type"),
      guardianName1:     t("membres.form.fields.guardianName", { number: 1 }),
      guardianPhone1:    t("membres.form.fields.guardianPhone", { number: 1 }),
      guardianName2:     t("membres.form.fields.guardianName", { number: 2 }),
      guardianPhone2:    t("membres.form.fields.guardianPhone", { number: 2 }),
      imageRights:       t("membres.form.fields.imageRights"),
    },
    civiliteOptions:    [t("membres.form.civilite.mme"), t("membres.form.civilite.mlle"), t("membres.form.civilite.m")],
    sexeOptions:        [t("membres.form.sexe.homme"), t("membres.form.sexe.femme")],
    imageRightsOptions: [t("membres.form.imageRights.granted"), t("membres.form.imageRights.refused")],
    signature: t("membres.fichePdf.signature"),
    date:      t("membres.fichePdf.date"),
  }

  const branding = resolveDocumentBranding(association)
  const pdf = await buildFicheMembreViergePdf({
    association: { name: association.name, logoUrl: branding.logoUrl },
    labels,
    // Same gate as the free-text guardian fields on the "Ajouter manuellement" screen
    // (security audit M2+L8) — a manager who can't see those fields on-screen shouldn't learn
    // from a printable sheet that the association collects them at all.
    includeGuardianFields: hasAccess(ctx.permissions, "sensible", "read"),
    legalConsent: legalDocuments.length === 0 ? null : {
      intro:          t("legalConsent.agreeLabel", { count: legalDocuments.length }),
      documentTitles: legalDocuments.map(document => document.title),
    },
  })

  const slug = association.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="fiche_membre_vierge_${slug}.pdf"`,
    },
  })
}, { area: "membres" })
