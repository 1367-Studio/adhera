import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { addressFormValues } from "@/lib/address"

// One-off "finish your adhésion" link for a member who self-registered via the portal
// (/api/portal/register) with no real Cotisation — never gained a User/password at
// registration time, only an account. Deliberately a separate, isolated pair of routes
// (this GET + the sibling POST at ./checkout) rather than another branch inside the real
// public checkout (src/app/api/public/[slug]/adhesion/[formSlug]/checkout/route.ts): that
// route is shared, live production code for every association's real adhésion payments, and
// a mistake in a one-off tool like this one has no business risking it. Reached via the
// unguessable Membre.adhesionCompletionToken, same convention as Cotisation.paymentToken.
async function findByToken(token: string) {
  return prisma.membre.findUnique({
    where:  { adhesionCompletionToken: token },
    select: {
      firstName: true, lastName: true, email: true, phone: true,
      addressStreet: true, addressComplement: true, postalCode: true, city: true, country: true, address: true,
      birthDate: true, sexe: true, spokenLanguage: true, photoUrl: true, answers: true,
      association: { select: { name: true, slug: true, stripeConnectId: true } },
      adhesionCompletionForm: {
        select: {
          id: true, slug: true, title: true, status: true,
          fieldAddress: true, fieldBirthDate: true, fieldPhone: true, fieldMobile: true,
          fieldGender: true, fieldPhoto: true, fieldLanguage: true,
          tiers: {
            where:   { itemType: "MEMBERSHIP", kind: "ONE_OFF", free: false },
            orderBy: { order: "asc" },
            select:  { id: true, label: true, freeAmount: true, amount: true, receiptMode: true, ineligibleAmount: true, membreTypeId: true },
          },
          customFields: {
            orderBy: { order: "asc" },
            select:  { id: true, type: true, label: true, required: true, options: true },
          },
        },
      },
    },
  })
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  // Purely informational and gated by a 160-bit token already, but rate-limited anyway for
  // consistency with every other public endpoint in this app.
  if (!(await rateLimit(`adhesion-completion-info:${requestIp(req)}`, 30, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const { token } = await params
  const membre = await findByToken(token)
  const form = membre?.adhesionCompletionForm
  if (!membre || !form || form.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Lien invalide" }, { status: 404 })
  }

  const answers = (membre.answers as Record<string, string> | null) ?? {}

  return NextResponse.json({
    associationName: membre.association.name,
    slug:            membre.association.slug,
    formId:          form.id,
    formSlug:        form.slug,
    formTitle:       form.title,
    online:          !!membre.association.stripeConnectId,
    fieldAddress:    form.fieldAddress,
    fieldBirthDate:  form.fieldBirthDate,
    fieldPhone:      form.fieldPhone,
    fieldMobile:     form.fieldMobile,
    fieldGender:     form.fieldGender,
    fieldPhoto:      form.fieldPhoto,
    fieldLanguage:   form.fieldLanguage,
    tiers: form.tiers.map(t => ({
      id: t.id, label: t.label, freeAmount: t.freeAmount, amount: t.amount?.toString() ?? null,
    })),
    customFields: form.customFields.map(f => ({ id: f.id, type: f.type, label: f.label, required: f.required, options: f.options })),
    prefill: {
      firstName: membre.firstName,
      lastName:  membre.lastName,
      email:     membre.email ?? "",
      phone:     membre.phone ?? "",
      mobile:    answers.mobile ?? "",
      ...addressFormValues(membre),
      birthDate: membre.birthDate ? membre.birthDate.toISOString().slice(0, 10) : "",
      sexe:      membre.sexe ?? "",
      spokenLanguage: membre.spokenLanguage ?? "",
      photoUrl:  membre.photoUrl ?? "",
      answers,
    },
  })
}
