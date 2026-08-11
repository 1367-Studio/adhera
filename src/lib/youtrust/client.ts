import { getYoutrustCredentials, getYoutrustBaseUrl } from "./config";

export class YoutrustApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

async function youtrustFetchWithKey(apiKey: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${getYoutrustBaseUrl()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new YoutrustApiError(`Youtrust API error (${res.status}): ${body}`, res.status);
  }

  return res.json();
}

async function youtrustFetch(associationId: string, path: string, init: RequestInit = {}) {
  const { apiKey } = await getYoutrustCredentials(associationId);
  return youtrustFetchWithKey(apiKey, path, init);
}

export async function createSignatureRequest(associationId: string, name: string) {
  return youtrustFetch(associationId, "/signature_requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      delivery_mode: "email", // Youtrust sends the signing-link emails itself
      signers_allowed_to_decline: true,
    }),
  }) as Promise<{ id: string; status: string }>;
}

export async function addDocument(
  associationId: string,
  signatureRequestId: string,
  pdf: Buffer,
  filename: string,
) {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), filename);
  form.append("nature", "signable_document");

  return youtrustFetch(associationId, `/signature_requests/${signatureRequestId}/documents`, {
    method: "POST",
    body: form,
  }) as Promise<{ id: string }>;
}

export async function addSigner(
  associationId: string,
  signatureRequestId: string,
  signer: { firstName: string; lastName: string; email: string },
) {
  return youtrustFetch(associationId, `/signature_requests/${signatureRequestId}/signers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      info: {
        first_name: signer.firstName,
        last_name: signer.lastName,
        email: signer.email,
        locale: "fr",
      },
      signature_level: "electronic_signature", // simple eSignature — suficiente para ata
      signature_authentication_mode: "otp_email", // não depende do Membre ter telefone
    }),
  }) as Promise<{ id: string; status: string }>;
}

export async function activateSignatureRequest(associationId: string, signatureRequestId: string) {
  return youtrustFetch(associationId, `/signature_requests/${signatureRequestId}/activate`, {
    method: "POST",
  }) as Promise<{ status: string; activated_at: string }>;
}

export async function createWebhookSubscription(apiKey: string, endpoint: string) {
  return youtrustFetchWithKey(apiKey, "/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint,
      subscribed_events: [
        "signature_request.done",
        "signature_request.expired",
        "signature_request.canceled",
        "signature_request.declined",
        "signer.notified",
        "signer.link_opened",
        "signer.done",
        "signer.declined",
        "signer.error",
      ],
      scopes: ["*"],
      sandbox: process.env.YOUTRUST_ENVIRONMENT !== "production",
      auto_retry: true,
      enabled: true,
      description: "Adhéra — signature des comptes rendus de réunion",
    }),
  }) as Promise<{ id: string; secret_key: string }>;
}
