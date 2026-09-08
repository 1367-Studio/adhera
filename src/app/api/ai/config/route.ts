import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { SUPPORTED_PROVIDERS, DEFAULT_MODELS, makeAiClient } from "@/lib/ai/client"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT"]

const schema = z.object({
  aiProvider: z.enum(SUPPORTED_PROVIDERS as [string, ...string[]]).nullable().optional(),
  // Key is optional — omitting it preserves the stored value; explicit null clears it.
  // Trimmed because a pasted key with trailing whitespace/newline still passes client-side
  // "looks non-empty" checks but fails provider auth with a bare 401 (no useful error body),
  // which is indistinguishable from a genuinely wrong key without this.
  aiApiKey: z.string().max(256).nullable().optional()
    .transform((v) => (v == null ? v : v.trim() || null)),
  aiModel:    z.string().max(128).nullable().optional(),
})

export const GET = withAdminAuth(async (req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { aiProvider: true, aiApiKey: true, aiModel: true },
  })

  return NextResponse.json({
    aiProvider:         assoc?.aiProvider ?? null,
    aiModel:            assoc?.aiModel    ?? null,
    aiApiKeyConfigured: !!assoc?.aiApiKey,
    usingPlatformKey:   !assoc?.aiApiKey && !!process.env.GROQ_API_KEY,
    supportedProviders: SUPPORTED_PROVIDERS,
    defaultModels:      DEFAULT_MODELS,
  })
})

export const PATCH = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 })

  const { aiProvider, aiApiKey, aiModel } = parsed.data

  const current = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { aiProvider: true },
  })

  // The UI (ai-settings.tsx) already refuses to submit a provider change without a fresh
  // key, but that's only enforced client-side — a direct API call could otherwise leave
  // aiProvider pointing at a new provider while aiApiKey still holds a key for the old one,
  // which only surfaces as a confusing auth failure the next time the AI feature is used.
  const providerChanging = aiProvider !== undefined && aiProvider !== null && aiProvider !== current?.aiProvider
  if (providerChanging && !aiApiKey) {
    return NextResponse.json(
      { error: "Une nouvelle clé API est requise pour changer de fournisseur." },
      { status: 422 },
    )
  }

  // Catch a wrong/mistyped/wrong-provider key at save time instead of letting it fail
  // silently until the association's next AI request. Skipped when only clearing the key
  // (aiApiKey === null) or leaving it untouched (undefined).
  if (aiApiKey) {
    const providerToValidate = aiProvider !== undefined ? (aiProvider ?? "groq") : (current?.aiProvider ?? "groq")
    const { client } = makeAiClient({ provider: providerToValidate, apiKey: aiApiKey })
    try {
      const models = await client.models.list()
      // Model is a free-text field (providers add/retire models faster than this list could
      // be hardcoded), so this only catches it here, at save time, instead of every one of
      // the 4 features that read it later failing with a confusing "model not found" error.
      if (aiModel && !models.data.some((m) => m.id === aiModel)) {
        return NextResponse.json(
          { error: `Le modèle "${aiModel}" n'est pas disponible pour ${providerToValidate}.` },
          { status: 422 },
        )
      }
    } catch (err) {
      console.error("[ai/config] key validation failed:", err)
      return NextResponse.json(
        { error: `Impossible de valider cette clé API auprès de ${providerToValidate}. Vérifiez qu'elle est correcte et active.` },
        { status: 422 },
      )
    }
  }

  await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      aiProvider: aiProvider !== undefined ? aiProvider : undefined,
      aiModel:    aiModel    !== undefined ? aiModel    : undefined,
      ...(aiApiKey !== undefined ? { aiApiKey: aiApiKey ?? null } : {}),
    },
  })

  // aiModel/aiProvider aren't secret, so their new values are logged directly — aiApiKey
  // is, so only whether it was touched is recorded, never the key itself.
  const aiChanges = {
    ...(aiProvider !== undefined ? { aiProvider } : {}),
    ...(aiModel    !== undefined ? { aiModel }    : {}),
    ...(aiApiKey   !== undefined ? { aiApiKeyChanged: true } : {}),
  }
  if (Object.keys(aiChanges).length > 0) {
    await writeActivityLog({
      associationId: ctx.associationId, actorId: ctx.userId, action: "AI_CONFIG_UPDATED",
      entity: "Association", entityId: ctx.associationId, metadata: aiChanges,
    })
  }

  return NextResponse.json({ ok: true })
})
