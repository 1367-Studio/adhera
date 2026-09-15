import { NextResponse } from "next/server"
import { z } from "zod"
import { resolveAiConfig } from "@/lib/ai/client"
import { completeText } from "@/lib/ai/complete"
import { normalizeAiHtml } from "@/lib/ai/normalize-html"
import { withAdminAuth } from "@/lib/api-wrapper"
import { rateLimit } from "@/lib/rate-limit"
import { fetchModules } from "@/lib/auth/require-module"
import { SITE_FONT_KEYS } from "@/lib/site-fonts"

const ADMINS = ["ADMIN", "PRESIDENT"]

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

// Every SectionType except the ones the "full" draft generator can produce fresh (see
// allowedSectionTypes) — "membership" only shows up here, for scope "section": editing an
// existing section's text doesn't care whether a *new* one of that type could be suggested,
// the section is already on the site (see the "dons"/"boutique" comment in [slug]/page.tsx —
// a section can outlive its module being toggled off).
const ALL_SECTION_TYPES = ["hero", "about", "events", "actualites", "membership", "dons", "boutique", "contact"] as const

const bodySchema = z.object({
  description: z.string().min(5).max(500),
  scope:       z.enum(["full", "appearance", "header", "footer", "section"]).default("full"),
  sectionType: z.enum(ALL_SECTION_TYPES).optional(),
}).refine(
  data => data.scope !== "section" || data.sectionType !== undefined,
  { message: "sectionType requis pour scope=\"section\"", path: ["sectionType"] },
)

const sectionSchema = z.object({
  type:        z.string(),
  // Optional despite every section needing a title on the builder side — a model dropping
  // it for a type whose *other* fields it focused on (about/dons) shouldn't fail the whole
  // draft; toSiteSection() on the client defaults a missing title to "" the same way the
  // public section components already do (section.title || <default label>).
  title:       z.string().max(80).optional(),
  subtitle:    z.string().max(300).optional(),
  content:     z.string().max(3000).optional(),
  body:        z.string().max(1000).optional(),
  buttonLabel: z.string().max(40).optional(),
})

const fullResponseSchema = z.object({
  primaryColor:       z.string().regex(HEX_COLOR),
  secondaryColor:     z.string().regex(HEX_COLOR),
  fontFamily:         z.enum(SITE_FONT_KEYS as [string, ...string[]]),
  headerBgColor:      z.string().regex(HEX_COLOR),
  headerShowMembres:  z.boolean(),
  headerShowRegister: z.boolean(),
  footerText:         z.string().max(200),
  footerBgColor:      z.string().regex(HEX_COLOR),
  sections:           z.array(sectionSchema).min(1).max(7),
})

const appearanceResponseSchema = z.object({
  primaryColor:   z.string().regex(HEX_COLOR),
  secondaryColor: z.string().regex(HEX_COLOR),
  fontFamily:     z.enum(SITE_FONT_KEYS as [string, ...string[]]),
})

const headerResponseSchema = z.object({
  headerBgColor: z.string().regex(HEX_COLOR),
})

const footerResponseSchema = z.object({
  footerText:    z.string().max(200),
  footerBgColor: z.string().regex(HEX_COLOR),
})

// Same per-section shape as the "full" draft's sectionSchema, minus `type` (the caller
// already knows it — it's the section being edited, not one being picked by the model).
const sectionResponseSchema = sectionSchema.omit({ type: true })

// Field rules per section type, shared by the "full" prompt's own "selon le type" sentence
// and by the "section" scope's single-type prompt below — keeps the two from drifting apart
// as the only description of which fields exist for which type.
const SECTION_FIELD_RULES: Record<string, { fields: string[]; hint: string }> = {
  hero:       { fields: ["title", "subtitle"], hint: "`subtitle` est une phrase d'accroche courte." },
  about:      { fields: ["title", "content"], hint: "`content` est un paragraphe de présentation." },
  events:     { fields: ["title"], hint: "" },
  actualites: { fields: ["title"], hint: "" },
  membership: { fields: ["title", "body"], hint: "`body` est un texte court incitant à rejoindre l'association." },
  dons:       { fields: ["title", "body", "buttonLabel"], hint: "`body` est un texte court incitant au don, `buttonLabel` est le texte du bouton (ex: \"Faire un don\")." },
  boutique:   { fields: ["title"], hint: "" },
  contact:    { fields: ["title"], hint: "" },
}

// title/subtitle/buttonLabel/footerText are all rendered as plain text on the public site (no
// dangerouslySetInnerHTML) — unlike content/body, which go through normalizeAiHtml below
// because they feed a rich-text field. Stray HTML a model emits despite the "JSON only, no
// markup" instruction would otherwise show up as literal "<p>...</p>" text instead of being
// interpreted, since nothing downstream parses these particular fields as HTML.
function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, "").trim()
}

const FRENCH_TONE = "Rédige tout le contenu en français, sur un ton chaleureux mais professionnel."
const JSON_ONLY = "Réponds UNIQUEMENT avec un objet JSON valide de cette forme exacte, sans texte autour ni bloc de code :"

// A generative draft (colors, font, header/footer, sections) for an empty site builder — see
// SiteAiAssistant (src/components/site/site-ai-assistant.tsx), which renders this as a
// non-destructive preview the admin must explicitly apply. Only ever proposes section types
// the association's own enabled modules actually support and colors/fonts on the site
// builder's own palette, so the draft can never suggest something the public site wouldn't
// render (a "dons" section on an association with the Dons module off, an unsupported font…).
function allowedSectionTypes(modules: Awaited<ReturnType<typeof fetchModules>>): string[] {
  return [
    "hero", "about", "contact",
    ...(modules.evenements ? ["events"] : []),
    ...(modules.actualites ? ["actualites"] : []),
    ...(modules.dons ? ["dons"] : []),
    ...(modules.boutique ? ["boutique"] : []),
  ]
}

function buildFullPrompt(types: string[]): string {
  return [
    "Tu es un assistant qui conçoit la structure et le contenu du site public d'une association française loi 1901, à partir d'une courte description fournie par l'administrateur de l'association.",
    `Types de sections autorisés : ${types.join(", ")}. N'utilise jamais un autre type que ceux-ci.`,
    `Polices autorisées (fontFamily) : ${SITE_FONT_KEYS.join(", ")}. Choisis celle qui correspond le mieux au ton de l'association décrite.`,
    JSON_ONLY,
    JSON.stringify({
      primaryColor: "#RRGGBB", secondaryColor: "#RRGGBB", fontFamily: "l'une des polices autorisées",
      headerBgColor: "#RRGGBB", headerShowMembres: true, headerShowRegister: true,
      footerText: "texte du pied de page", footerBgColor: "#RRGGBB",
      sections: [{ type: "hero", title: "...", subtitle: "..." }],
    }),
    "Chaque section, quel que soit son type, doit obligatoirement avoir un `title` (même bref). En plus de `title`, selon le `type` : `hero` a aussi `subtitle` ; `about` a aussi `content` (un paragraphe de présentation) ; `dons` a aussi `body` (un texte court incitant au don) et `buttonLabel` ; les types events/actualites/boutique/contact n'ont besoin de rien d'autre que `title`. N'omets jamais `title`, même sur une section `about` ou `dons`.",
    "Inclus toujours une section hero en premier. N'invente jamais de champ hors de cette liste.",
    "Choisis des couleurs primaire et secondaire cohérentes entre elles et avec le ton de l'association (évite le violet par défaut #6366f1 sauf s'il correspond vraiment).",
    FRENCH_TONE,
  ].join("\n")
}

function buildAppearancePrompt(): string {
  return [
    "Tu es un assistant qui choisit une palette de couleurs (principale + secondaire) et une police pour le site public d'une association française loi 1901, à partir d'une courte description.",
    `Polices autorisées (fontFamily) : ${SITE_FONT_KEYS.join(", ")}. Choisis celle qui correspond le mieux au ton de l'association décrite.`,
    JSON_ONLY,
    JSON.stringify({ primaryColor: "#RRGGBB", secondaryColor: "#RRGGBB", fontFamily: "l'une des polices autorisées" }),
    "Choisis des couleurs primaire et secondaire cohérentes entre elles et avec le ton de l'association (évite le violet par défaut #6366f1 sauf s'il correspond vraiment).",
  ].join("\n")
}

function buildHeaderPrompt(): string {
  return [
    "Tu es un assistant qui choisit la couleur de fond de l'en-tête (barre de navigation) du site public d'une association française loi 1901, à partir d'une courte description.",
    JSON_ONLY,
    JSON.stringify({ headerBgColor: "#RRGGBB" }),
  ].join("\n")
}

function buildFooterPrompt(): string {
  return [
    "Tu es un assistant qui rédige le texte du pied de page (mention/copyright) et choisit sa couleur de fond, pour le site public d'une association française loi 1901, à partir d'une courte description.",
    JSON_ONLY,
    JSON.stringify({ footerText: "texte court du pied de page", footerBgColor: "#RRGGBB" }),
    "`footerText` tient sur une ligne (ex: une mention de copyright ou un court message de remerciement).",
    FRENCH_TONE,
  ].join("\n")
}

function buildSectionPrompt(sectionType: string): string {
  const rule = SECTION_FIELD_RULES[sectionType] ?? SECTION_FIELD_RULES.contact
  const example = Object.fromEntries(rule.fields.map(f => [f, "..."]))
  return [
    `Tu es un assistant qui rédige le contenu d'une section "${sectionType}" du site public d'une association française loi 1901, à partir d'une courte description ou instruction fournie par l'administrateur.`,
    JSON_ONLY,
    JSON.stringify(example),
    `\`title\` est obligatoire, même bref.${rule.hint ? ` ${rule.hint}` : ""} N'invente jamais de champ hors de cette liste.`,
    FRENCH_TONE,
  ].join("\n")
}

export const POST = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 })
  const { description, scope, sectionType } = parsed.data

  const aiConfig    = await resolveAiConfig(ctx.associationId)
  const usingOwnKey = !!aiConfig && !aiConfig.usingPlatform

  // Every scope shares one rate-limit bucket — all of them are the same "category" of usage
  // (an occasional admin-initiated draft, not a per-keystroke action). Heavier than per-field
  // writing (/api/ai/write, 20/10min).
  if (!usingOwnKey && !(await rateLimit(`ai-site-assistant:${ctx.associationId}`, 8, 15 * 60_000))) {
    return NextResponse.json({ error: "Trop de requêtes, réessayez plus tard." }, { status: 429 })
  }

  if (!aiConfig) {
    return NextResponse.json(
      { error: "Aucune clé API configurée. Ajoutez votre clé API dans Paramètres → IA." },
      { status: 503 }
    )
  }

  const system = scope === "full"
    // Reuses the same React-cache()'d lookup withAdminAuth's { module: "ia" } guard already
    // made for this request (and the one place plan-tier module overrides are applied, via
    // deriveModulesForPlan) — a second raw prisma query here would silently diverge from it.
    ? buildFullPrompt(allowedSectionTypes(await fetchModules(ctx.associationId)))
    : scope === "appearance" ? buildAppearancePrompt()
    : scope === "header"     ? buildHeaderPrompt()
    : scope === "footer"     ? buildFooterPrompt()
    : buildSectionPrompt(sectionType!)

  try {
    const raw = await completeText(aiConfig, {
      system,
      user:      description,
      maxTokens: 3000,
      json:      true,
    })

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(raw)
    } catch (err) {
      console.error(`[ai-site-assistant:${scope}] JSON.parse failed:`, err, "raw:", raw)
      return NextResponse.json({ error: "L'IA a renvoyé une réponse invalide, réessayez." }, { status: 502 })
    }

    if (scope !== "full") {
      const schema = scope === "appearance" ? appearanceResponseSchema
        : scope === "header" ? headerResponseSchema
        : scope === "footer" ? footerResponseSchema
        : sectionResponseSchema
      const result = schema.safeParse(parsedJson)
      if (!result.success) {
        console.error(`[ai-site-assistant:${scope}] schema validation failed:`, result.error.issues, "raw:", raw)
        return NextResponse.json({ error: "L'IA a renvoyé une réponse invalide, réessayez." }, { status: 502 })
      }
      if (scope === "footer") {
        const footer = result.data as z.infer<typeof footerResponseSchema>
        return NextResponse.json({ ...footer, footerText: stripTags(footer.footerText) })
      }

      if (scope === "section") {
        const data = result.data as z.infer<typeof sectionResponseSchema>
        return NextResponse.json({
          ...data,
          title:       stripTags(data.title ?? ""),
          subtitle:    data.subtitle !== undefined ? stripTags(data.subtitle) : undefined,
          buttonLabel: data.buttonLabel !== undefined ? stripTags(data.buttonLabel) : undefined,
          content:     data.content !== undefined ? normalizeAiHtml(data.content) : undefined,
          body:        data.body !== undefined ? normalizeAiHtml(data.body) : undefined,
        })
      }

      return NextResponse.json(result.data)
    }

    const result = fullResponseSchema.safeParse(parsedJson)
    if (!result.success) {
      console.error("[ai-site-assistant:full] schema validation failed:", result.error.issues, "raw:", raw)
      return NextResponse.json({ error: "L'IA a renvoyé une réponse invalide, réessayez." }, { status: 502 })
    }

    const draft = result.data
    const types = allowedSectionTypes(await fetchModules(ctx.associationId))
    const seenTypes = new Set<string>()
    const sections = draft.sections
      // Defense in depth: the prompt already restricts types, but never trust a model's
      // instruction-following over the association's actual module state.
      .filter(s => types.includes(s.type))
      // The add-section menu never lets an admin create two sections of the same type
      // (site-controls-panel.tsx's existingTypes check) — a model isn't bound by that same
      // UI constraint and nothing here stops it repeating "hero" or "about" twice, which
      // would render as visibly duplicated stacked sections. Keep the first of each type,
      // matching the prompt's own "hero first" instruction.
      .filter(s => (seenTypes.has(s.type) ? false : (seenTypes.add(s.type), true)))
      .map(s => ({
        ...s,
        title:       stripTags(s.title ?? ""),
        subtitle:    s.subtitle !== undefined ? stripTags(s.subtitle) : undefined,
        buttonLabel: s.buttonLabel !== undefined ? stripTags(s.buttonLabel) : undefined,
        // Never let raw model HTML/text reach the builder unnormalized, even for a preview.
        content: s.content !== undefined ? normalizeAiHtml(s.content) : undefined,
        body:    s.body !== undefined ? normalizeAiHtml(s.body) : undefined,
      }))

    // Every section failed the type/dedupe filter above (a model ignoring the allowed-types
    // instruction entirely) — returning 200 with an empty sections array would show as a
    // silently "successful" draft with nothing in it, which reads as broken rather than as
    // the error it actually is.
    if (sections.length === 0) {
      console.error("[ai-site-assistant:full] all sections filtered out, raw:", raw)
      return NextResponse.json({ error: "L'IA a renvoyé une réponse invalide, réessayez." }, { status: 502 })
    }

    return NextResponse.json({ ...draft, footerText: stripTags(draft.footerText), sections })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erreur IA"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}, { module: "ia", roles: ADMINS })
