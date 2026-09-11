import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { SUPPORTED_PROVIDERS, DEFAULT_MODELS, isAnthropicProvider, makeAiClient, makeAnthropicClient } from "@/lib/ai/client"
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

// Model is a free-text field (providers add/retire models faster than this list could be
// hardcoded), so it is only checked here, at save time, instead of every feature that reads
// it later failing with a confusing "model not found" error. Throws when the provider
// rejects the key itself; resolves to false when the key works but the model does not exist.

function describeValidationError(error: unknown): string {
  if (error instanceof Anthropic.APIError) return `réponse ${error.status ?? "?"} — ${error.message.slice(0, 160)}`
  if (error instanceof OpenAI.APIError)    return `réponse ${error.status ?? "?"} — ${error.message.slice(0, 160)}`
  if (error instanceof Error)              return error.message.slice(0, 160)
  return "erreur inconnue"
}

async function providerAcceptsModel(provider: string, apiKey: string, model: string | null | undefined): Promise<boolean> {
  if (isAnthropicProvider(provider)) {
    const { client } = makeAnthropicClient({ provider, apiKey })
    // Iterating the page auto-paginates; a wrong key throws (AuthenticationError) right here.
    const modelIds: string[] = []
    for await (const modelInfo of client.models.list()) modelIds.push(modelInfo.id)
    if (!model || modelIds.includes(model)) return true

    // Older generations are only listed under their dated ids, so an alias such as
    // "claude-opus-4-1" is absent from the listing — retrieve resolves aliases and 404s for
    // a model that genuinely does not exist.
    try {
      await client.models.retrieve(model)
      return true
    } catch (error) {
      if (error instanceof Anthropic.NotFoundError) return false
      throw error
    }
  }

  const { client } = makeAiClient({ provider, apiKey })
  const models = await client.models.list()
  return !model || models.data.some((modelInfo) => modelInfo.id === model)
}

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
    try {
      if (!(await providerAcceptsModel(providerToValidate, aiApiKey, aiModel))) {
        return NextResponse.json(
          { error: `Le modèle "${aiModel}" n'est pas disponible pour ${providerToValidate}.` },
          { status: 422 },
        )
      }
    } catch (err) {
      console.error("[ai/config] key validation failed:", err)
      // The provider's own answer (401 invalid key, 403 permission, network…) is the only
      // clue the user gets, so it travels with the message — it never contains the key.
      return NextResponse.json(
        { error: `Impossible de valider cette clé API auprès de ${providerToValidate} : ${describeValidationError(err)}. Vérifiez qu'elle est correcte et active.` },
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
