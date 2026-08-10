import { prisma } from "@/lib/prisma/client";

export class YoutrustConfigError extends Error {}

const SANDBOX_BASE_URL = "https://api-sandbox.yousign.app/v3";
const PRODUCTION_BASE_URL = "https://api.yousign.app/v3";

export function getYoutrustBaseUrl(): string {
  return process.env.YOUTRUST_ENVIRONMENT === "production"
    ? PRODUCTION_BASE_URL
    : SANDBOX_BASE_URL;
}

// BYOA only, no platform fallback — same shape as src/lib/sms.ts's getCredentials().
export async function getYoutrustCredentials(associationId: string) {
  const association = await prisma.association.findUnique({
    where: { id: associationId },
    select: { youtrustApiKey: true, youtrustWebhookSecret: true },
  });

  if (!association?.youtrustApiKey) {
    throw new YoutrustConfigError("Youtrust non configuré pour cette association.");
  }

  return {
    apiKey: association.youtrustApiKey,
    webhookSecret: association.youtrustWebhookSecret,
    baseUrl: getYoutrustBaseUrl(),
  };
}
