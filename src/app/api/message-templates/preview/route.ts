import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { customEmail } from "@/lib/email"
import { resolveEmailBranding } from "@/lib/plan-limits"
import { substituteVars, buildVars } from "@/lib/automation"
import { emailBlockSchema, renderBlocksToHtml } from "@/lib/email-blocks"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

// A wider image.url than emailBlockSchema allows — the *save* routes reject anything but a
// short R2 URL there on purpose (never let a giant base64 blob into the stored `blocks` JSON
// or the sent email's HTML). This preview route is the one place that's actually supposed to
// receive one: a still-unsaved image block's blob: URL gets turned into a data: URI
// client-side (see EmailBlockEditorHandle.getPreviewBlocks) specifically because the
// preview's sandboxed iframe can't resolve a blob: URL from outside itself. Capped at 6M
// chars — comfortably covers the ~4 MB (before base64) the block editor itself will actually
// send (see its own 3 MB pre-encoding size guard) without accepting something unbounded.
const previewBlockSchema = z.discriminatedUnion("type", [
  emailBlockSchema.options[0],
  z.object({ id: z.string(), type: z.literal("image"), url: z.string().max(6_000_000), alt: z.string().max(200).optional(), linkUrl: z.string().max(1000).optional() }),
  emailBlockSchema.options[2],
  emailBlockSchema.options[3],
])

const schema = z.object({
  subject: z.string(),
  body:    z.string().optional(),
  blocks:  z.array(previewBlockSchema).max(50).optional(),
})

// Same fake data as the retired client-side PREVIEW_VARS in template-modal.tsx — kept here
// now that this route replaces that component's local rendering. Domain-less
// lienRenouvellement on purpose: an absolute fake URL on an unrelated-looking domain reads
// as a mistake or a broken/suspicious link if an admin clicks it from the preview; a
// path with no domain instead resolves back into this same app (a harmless 404) if clicked,
// exactly like the rest of this preview's fake data (fake amount, fake event name) isn't
// meant to be real either.
function buildPreviewVars() {
  return buildVars({
    prenom:             "Prénom",
    nom:                "Nom",
    email:              "prenom.nom@example.com",
    association:        "Votre association",
    slug:               "demo",
    anneeCotisation:    new Date().getFullYear(),
    montantCotisation:  "50",
    titreEvenement:     "Événement de test",
    dateEvenement:      new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }),
    lieuEvenement:      "Salle des fêtes",
    dateExpiration:     new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }),
    lienRenouvellement: "/mon-asso/adhesion/exemple",
  })
}

// Renders a MessageTemplate draft (saved or not — the modal calls this on every unsaved
// keystroke's worth of content) through the exact same wrapper every real send goes
// through (customEmail() → layout() in src/lib/email.ts), using the association's actual
// current branding (header color/logo, footer style/social links, signature). Without this,
// the modal's own preview only ever showed the body content in isolation — never the
// header/footer an admin configures separately in Paramètres → Identité visuelle — which
// is confusing on its own screen, not just a "different feature" gap.
export const POST = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const association = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { name: true },
  })
  if (!association) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const vars = buildPreviewVars()
  const resolvedBody = parsed.data.blocks ? renderBlocksToHtml(parsed.data.blocks) : (parsed.data.body ?? "")

  const branding = await resolveEmailBranding(ctx.associationId)
  const { subject, html } = customEmail({
    associationName: association.name,
    subject:         substituteVars(parsed.data.subject, vars),
    bodyHtml:        substituteVars(resolvedBody, vars),
    recipientEmail:  "preview@example.com",
    branding,
  })

  return NextResponse.json({ subject, html })
}, { roles: ALLOWED_ROLES, module: "messages" })
