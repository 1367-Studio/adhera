import { NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api-wrapper";
import { prisma } from "@/lib/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { createWebhookSubscription, YoutrustApiError } from "@/lib/youtrust/client";
import { APP_URL, BASE_PATH } from "@/lib/env";

const MANAGERS = ["ADMIN", "PRESIDENT"];

const schema = z.object({
  youtrustApiKey: z.string().max(512).nullable().optional(),
});

export const GET = withAdminAuth(async (req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where: { id: ctx.associationId },
    select: { youtrustApiKey: true },
  });

  return NextResponse.json({ youtrustConfigured: !!assoc?.youtrustApiKey });
});

export const PATCH = withAdminAuth(async (req, ctx) => {
  if (!MANAGERS.includes(ctx.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 });

  const { youtrustApiKey } = parsed.data;

  let youtrustWebhookSecret: string | null = null;
  if (youtrustApiKey) {
    try {
      const endpoint = `${APP_URL}${BASE_PATH}/api/webhook/youtrust/${ctx.associationId}`;
      const subscription = await createWebhookSubscription(youtrustApiKey, endpoint);
      youtrustWebhookSecret = subscription.secret_key;
        } catch (err) {
          console.error("[youtrust] webhook subscription failed:", err);
          return NextResponse.json(
            {
              error:
                err instanceof YoutrustApiError
                  ? "Clé API Youtrust invalide ou refusée."
                  : "Erreur lors de la configuration du webhook Youtrust.",
            },
            { status: 400 },
          );
        }
  }

  const updated = await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      ...(youtrustApiKey !== undefined ? { youtrustApiKey: youtrustApiKey ?? null } : {}),
      ...(youtrustApiKey !== undefined
        ? { youtrustWebhookSecret: youtrustApiKey ? youtrustWebhookSecret : null }
        : {}),
    },
    select: { youtrustApiKey: true },
  });

  // Field names only, never the values — same rule as smsAccountSid/smsAuthToken.
  const fieldsChanged = [youtrustApiKey !== undefined && "youtrustApiKey"].filter(Boolean);
  if (fieldsChanged.length > 0) {
    await writeActivityLog({
      associationId: ctx.associationId,
      actorId: ctx.userId,
      action: "YOUTRUST_SETTINGS_UPDATED",
      entity: "Association",
      entityId: ctx.associationId,
      metadata: { fieldsChanged },
    });
  }

  return NextResponse.json({ ok: true, youtrustConfigured: !!updated.youtrustApiKey });
});
