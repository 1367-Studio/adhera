import { z } from "zod"

// Visual layouts the card can be rendered with — the renderer (phase 2) owns what each one
// looks like; this list only fixes which names are valid to store.
export const MEMBER_CARD_TEMPLATES = ["classic", "modern", "minimal"] as const
export type MemberCardTemplate = (typeof MEMBER_CARD_TEMPLATES)[number]

// Same "#RRGGBB" shape as Association.primaryColor — a 3-digit or named colour is rejected
// rather than normalized, so the card renderer only ever has to handle one format.
export const MEMBER_CARD_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

// Strict shape, for validating what an admin submits (the settings route, phase 2) — an
// invalid value there should be a 400, not silently replaced by a default.
export const memberCardSettingsSchema = z.object({
  enabled:      z.boolean(),
  template:     z.enum(MEMBER_CARD_TEMPLATES),
  // null = "no colour chosen": the renderer falls back to its default instead of storing one
  // here, so changing that default later reaches every association that never picked one.
  color:        z.string().regex(MEMBER_CARD_COLOR_PATTERN).nullable(),
  showPhoto:    z.boolean(),
  showCategory: z.boolean(),
  // The *association's* phone and contact e-mail, not the member's: a card is handed to third
  // parties (a partner, a venue, a controller), so the only contact details it may carry are
  // the ones the association already publishes. Both off by default — see below.
  showPhone:    z.boolean(),
  showEmail:    z.boolean(),
})

export type MemberCardSettings = z.infer<typeof memberCardSettingsSchema>

// Off until an admin deliberately turns it on — a card is a public, scannable proof of
// membership, so an association must opt in rather than find every member carrying one.
export const DEFAULT_MEMBER_CARD_SETTINGS: MemberCardSettings = {
  enabled:      false,
  template:     "classic",
  color:        null,
  showPhoto:    true,
  showCategory: true,
  // Off, unlike the two above: an association that filled in a phone number for its invoices
  // never asked for it to be printed on every member's card, and a card can be photographed
  // and forwarded by anyone holding it. Publishing those details is a deliberate decision.
  showPhone:    false,
  showEmail:    false,
}

// Lenient twin of memberCardSettingsSchema for *reading* Association.memberCardSettings: each
// field falls back to its own default on its own (`.catch`), so one bad or missing key — a
// hand-edited row, a key added by a later version — never resets the others, and above all
// never turns `enabled` off (or on) as a side effect of an unrelated field.
const storedMemberCardSettingsSchema = z.object({
  enabled:      memberCardSettingsSchema.shape.enabled.catch(DEFAULT_MEMBER_CARD_SETTINGS.enabled),
  template:     memberCardSettingsSchema.shape.template.catch(DEFAULT_MEMBER_CARD_SETTINGS.template),
  color:        memberCardSettingsSchema.shape.color.catch(DEFAULT_MEMBER_CARD_SETTINGS.color),
  showPhoto:    memberCardSettingsSchema.shape.showPhoto.catch(DEFAULT_MEMBER_CARD_SETTINGS.showPhoto),
  showCategory: memberCardSettingsSchema.shape.showCategory.catch(DEFAULT_MEMBER_CARD_SETTINGS.showCategory),
  // Missing from every row written before these two settings existed, which is exactly the
  // case `.catch` covers: an association that never saw the checkboxes keeps a card with no
  // contact line rather than suddenly publishing its phone number.
  showPhone:    memberCardSettingsSchema.shape.showPhone.catch(DEFAULT_MEMBER_CARD_SETTINGS.showPhone),
  showEmail:    memberCardSettingsSchema.shape.showEmail.catch(DEFAULT_MEMBER_CARD_SETTINGS.showEmail),
})

// The only way Association.memberCardSettings (Json?) should be read. null — an association
// that never opened the settings — and anything that isn't an object both yield the defaults,
// i.e. a disabled card.
export function parseMemberCardSettings(raw: unknown): MemberCardSettings {
  const parsed = storedMemberCardSettingsSchema.safeParse(raw)
  return parsed.success ? parsed.data : { ...DEFAULT_MEMBER_CARD_SETTINGS }
}
