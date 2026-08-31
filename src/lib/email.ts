import { APP_NAME } from "@/config/brand"

// Free-text user input (e.g. a custom message on a Devis/Facture send) interpolated into
// an HTML email must be escaped — otherwise it's rendered as markup by the recipient's
// mail client instead of shown as plain text.
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// ─── Base layout ─────────────────────────────────────────────────────────────

// Resolved via resolveDocumentBranding() (src/lib/plan-limits.ts) at each call site —
// already null when the association's plan doesn't include custom branding, so this
// file doesn't need to know about plans.
export type EmailBranding = { logoUrl: string | null } | null | undefined

// The accent shows through the header's top bar and the button, not as a full-bleed
// banner behind white text — restrained, and it keeps a transparent-background logo
// visible against a plain white header. Kept just short of pure black: Apple Mail/
// Outlook's automatic dark-mode repainting specifically targets #000/#fff pairs for
// inversion (which flips this into unreadable dark-on-dark), and is less aggressive
// with an near-black value that already reads as "intentionally dark".
const ACCENT = "#18181b"

function layout(associationName: string, content: string, branding?: EmailBranding): string {
  const accent = ACCENT
  const nameEsc = escapeHtml(associationName)
  const headerInner = branding?.logoUrl
    ? `<table cellpadding="0" cellspacing="0"><tr>
        <td style="vertical-align:middle;"><img src="${branding.logoUrl}" alt="${nameEsc}" height="32" style="display:block;max-height:32px;max-width:180px;width:auto;"></td>
        <td style="vertical-align:middle;padding-left:12px;"><span style="color:#3f3f46;font-size:14px;font-weight:600;">${nameEsc}</span></td>
      </tr></table>`
    : `<span style="color:#18181b;font-size:17px;font-weight:700;letter-spacing:-0.3px;">${nameEsc}</span>`
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <style>
    :root { color-scheme: light; supported-color-schemes: light; }
    /* Belt-and-suspenders for clients (Gmail app, some Outlook builds) that ignore the
       meta tags above and repaint dark-mode colors from CSS instead — pins the card and
       button back to their authored light-mode colors. */
    @media (prefers-color-scheme: dark) {
      .email-card, .email-btn { background: ${accent} !important; }
      .email-card-bg { background: #fff !important; }
      .email-btn a { color: #fff !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#111;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" bgcolor="#ffffff" class="email-card-bg" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr>
          <td class="email-card" bgcolor="${accent}" style="background:${accent};padding:4px;font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td class="email-card-bg" bgcolor="#ffffff" style="background:#fff;padding:24px 40px;border-bottom:1px solid #e4e4e7;">
            ${headerInner}
          </td>
        </tr>
        <tr>
          <td class="email-card-bg" bgcolor="#ffffff" style="background:#fff;padding:36px 40px;color:#111;">
            ${content}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 40px;border-top:1px solid #e4e4e7;background:#fafafa;">
            <p style="margin:0;font-size:12px;color:#71717a;text-align:center;">
              Email automatique envoyé par ${associationName} via ${APP_NAME}.<br>
              Veuillez ne pas répondre directement à cet email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function btn(label: string, url: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
    <tr><td class="email-btn" bgcolor="${ACCENT}" style="border-radius:6px;background:${ACCENT};">
      <a href="${url}" style="display:inline-block;padding:12px 28px;color:#fff;font-size:14px;font-weight:600;text-decoration:none;">${label}</a>
    </td></tr>
  </table>`
}

// QR d'entrée d'un billet — image hébergée (/api/public/billet/[token]/qr, les clients
// mail suppriment les data URIs) + lien vers la page publique du billet (/billet/[token])
// pour les clients qui bloquent les images distantes.
export type TicketQr = { imageUrl: string; pageUrl: string; name?: string }

function ticketQrSection(qrs: TicketQr[]): string {
  if (!qrs.length) return ""
  const blocks = qrs.map(qr => `
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 16px;">
      ${qrs.length > 1 && qr.name ? `<tr><td align="center" style="padding-bottom:6px;font-size:13px;font-weight:600;">${escapeHtml(qr.name)}</td></tr>` : ""}
      <tr><td align="center">
        <img src="${qr.imageUrl}" width="160" height="160" alt="QR code du billet" style="display:block;border:1px solid #e5e7eb;border-radius:8px;background:#fff;">
      </td></tr>
      <tr><td align="center" style="padding-top:6px;">
        <a href="${qr.pageUrl}" style="font-size:12px;color:#71717a;">Voir ${qrs.length > 1 ? "ce" : "mon"} billet en ligne</a>
      </td></tr>
    </table>`).join("")
  return `
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;box-sizing:border-box;">
      <tr><td align="center" style="padding-bottom:12px;">
        <span style="font-size:13px;color:#6b7280;">${qrs.length > 1 ? "Vos QR codes d'entrée" : "Votre QR code d'entrée"}</span>
      </td></tr>
      <tr><td>${blocks}</td></tr>
      <tr><td align="center">
        <span style="font-size:12px;color:#71717a;">Présentez ${qrs.length > 1 ? "ces QR codes" : "ce QR code"} à l'entrée de l'événement — l'organisateur ${qrs.length > 1 ? "les" : "le"} scannera pour valider votre présence.</span>
      </td></tr>
    </table>`
}

// ─── Templates ────────────────────────────────────────────────────────────────

export function welcomeEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  hasPortalAccess: boolean
  portalUrl:       string
  branding?:       EmailBranding
}) {
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Bienvenue, ${p.firstName} !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Vous avez été ajouté(e) comme membre de <strong>${p.associationName}</strong>.
      ${p.hasPortalAccess
        ? "Vous pouvez accéder à votre espace membre pour consulter les événements, actualités et gérer votre adhésion."
        : "N'hésitez pas à contacter votre association pour toute question."}
    </p>
    ${p.hasPortalAccess ? btn("Accéder à mon espace", p.portalUrl) : ""}
    ${p.hasPortalAccess
      ? `<p style="margin:0;font-size:13px;color:#71717a;">Connectez-vous avec l'adresse <strong>${p.email}</strong>.</p>`
      : ""}`
  return {
    to:      p.email,
    subject: `Bienvenue dans ${p.associationName}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function invitationEmail(p: {
  firstName:       string
  email:           string
  password:        string
  associationName: string
  role:            string
  loginUrl:        string
  branding?:       EmailBranding
  // Set when a default cotisation was auto-created for this member — same reasoning as
  // portalWelcomeEmail's cotisation note.
  cotisation?: { amount: number; year: number }
}) {
  const isStaff   = p.role !== "MEMBRE"
  const roleLabel: Record<string, string> = {
    MEMBRE:     "membre",
    SECRETAIRE: "secrétaire",
    TRESORIER:  "trésorier",
    PRESIDENT:  "président",
    ADMIN:      "administrateur",
  }
  const label   = roleLabel[p.role] ?? p.role.toLowerCase()
  const context = isStaff
    ? `Vous avez été invité(e) en tant que <strong>${label}</strong> de <strong>${p.associationName}</strong>. Vous pouvez accéder à l'espace de gestion de l'association.`
    : `Vous avez été invité(e) comme <strong>${label}</strong> de <strong>${p.associationName}</strong>. Vous pouvez accéder à votre espace membre pour consulter les événements, actualités et gérer votre adhésion.`

  const cotisationNote = p.cotisation ? `
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3f3f46;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;">
      Une cotisation ${p.cotisation.year} de <strong>${p.cotisation.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</strong> vous attend — réglable directement depuis votre espace membre, onglet « Cotisation ».
    </p>` : ""

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Bienvenue, ${p.firstName} !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">${context}</p>
    ${cotisationNote}
    ${btn(isStaff ? "Accéder à la gestion" : "Accéder à mon espace", p.loginUrl)}
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f4f4f5;border-radius:8px;padding:16px 20px;width:100%;">
      <tr>
        <td style="font-size:13px;color:#71717a;padding-bottom:6px;">Vos identifiants de connexion</td>
      </tr>
      <tr>
        <td style="font-size:14px;"><strong>Email :</strong> ${p.email}</td>
      </tr>
      <tr>
        <td style="font-size:14px;padding-top:4px;"><strong>Mot de passe :</strong> ${p.password}</td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#71717a;">Nous vous recommandons de changer votre mot de passe après votre première connexion. Vous pouvez également utiliser <a href="${p.loginUrl.replace(/\/login.*/, "/forgot-password")}" style="color:#18181b;">mot de passe oublié</a> à tout moment.</p>`

  return {
    to:      p.email,
    subject: `Invitation — ${p.associationName}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function rsvpConfirmationEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  eventTitle:      string
  eventDate:       Date
  eventLocation:   string | null
  portalUrl:       string
  // Only set for public/guest registrations (no portal account to cancel from) — see
  // src/app/api/public/cancel-ticket/[token]/route.ts.
  cancelUrl?:      string
  // QR d'entrée du billet — absent pour les rows créées avant la fonctionnalité.
  ticketQr?:       TicketQr
  branding?:       EmailBranding
}) {
  const dateStr = p.eventDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const timeStr = p.eventDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Participation confirmée</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>votre participation à l'événement suivant a bien été enregistrée.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      <tr><td style="padding-bottom:10px;">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Événement</span>
        <span style="font-size:15px;font-weight:600;">${p.eventTitle}</span>
      </td></tr>
      <tr><td style="padding-bottom:${p.eventLocation ? "10px" : "0"};">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Date</span>
        <span style="font-size:14px;">${dateStr} à ${timeStr}</span>
      </td></tr>
      ${p.eventLocation ? `<tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Lieu</span>
        <span style="font-size:14px;">${p.eventLocation}</span>
      </td></tr>` : ""}
    </table>
    ${p.ticketQr ? ticketQrSection([p.ticketQr]) : ""}
    ${btn("Voir l'événement", p.portalUrl)}
    ${p.cancelUrl ? `<p style="margin:0;font-size:12px;color:#71717a;">Un empêchement ? <a href="${p.cancelUrl}" style="color:#71717a;">Annuler ma participation</a>.</p>` : ""}`
  return {
    to:      p.email,
    subject: `Confirmation — ${p.eventTitle}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function sondageInvitationEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  sondageTitle:    string
  deadline:        Date | null
  portalUrl:       string
  branding?:       EmailBranding
}) {
  const deadlineStr = p.deadline
    ? p.deadline.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : null
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Nouveau sondage</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br><strong>${p.associationName}</strong> vous invite à répondre au sondage suivant.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      <tr><td style="padding-bottom:${deadlineStr ? "10px" : "0"};">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Sondage</span>
        <span style="font-size:15px;font-weight:600;">${p.sondageTitle}</span>
      </td></tr>
      ${deadlineStr ? `<tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Date limite</span>
        <span style="font-size:14px;">${deadlineStr}</span>
      </td></tr>` : ""}
    </table>
    ${btn("Répondre au sondage", p.portalUrl)}`
  return {
    to:      p.email,
    subject: `Sondage — ${p.sondageTitle}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function checkInReceiptEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  eventTitle:      string
  eventDate:       Date
  branding?:       EmailBranding
}) {
  const dateStr = p.eventDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Présence enregistrée ✓</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>votre présence au <strong>${p.eventTitle}</strong> du ${dateStr} a bien été enregistrée.
    </p>
    <p style="margin:0;font-size:13px;color:#71717a;">
      Merci de votre participation !
    </p>`
  return {
    to:      p.email,
    subject: `Présence confirmée — ${p.eventTitle}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function paymentConfirmationEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  amount:          number | null
  period:          string | null
  paidAt:          Date
  branding?:       EmailBranding
}) {
  const amountStr = p.amount != null
    ? Number(p.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
    : "—"
  const dateStr = p.paidAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Paiement reçu</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>votre cotisation a bien été reçue. Merci !
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      ${p.period ? `<tr><td style="padding-bottom:10px;">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Période</span>
        <span style="font-size:14px;">${p.period}</span>
      </td></tr>` : ""}
      <tr><td style="padding-bottom:10px;">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Montant</span>
        <span style="font-size:16px;font-weight:700;">${amountStr}</span>
      </td></tr>
      <tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Date de paiement</span>
        <span style="font-size:14px;">${dateStr}</span>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#71717a;">Conservez cet email comme confirmation de paiement.</p>`
  return {
    to:      p.email,
    subject: `Confirmation de cotisation — ${p.associationName}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function eventReminderEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  eventTitle:      string
  eventDate:       Date
  eventLocation:   string | null
  portalUrl:       string
  daysBefore?:     number
  branding?:       EmailBranding
}) {
  const days = p.daysBefore ?? 1
  const whenLabel = days === 0
    ? "aujourd'hui"
    : days === 1
      ? "demain"
      : `dans ${days} jours`
  const timeStr = p.eventDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  const dateStr = p.eventDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Rappel — ${whenLabel}</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>nous vous rappelons que vous participez à l'événement suivant <strong>${whenLabel}</strong>.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      <tr><td style="padding-bottom:10px;">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Événement</span>
        <span style="font-size:15px;font-weight:600;">${p.eventTitle}</span>
      </td></tr>
      <tr><td style="padding-bottom:10px;">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Date</span>
        <span style="font-size:14px;">${dateStr} à ${timeStr}</span>
      </td></tr>
      ${p.eventLocation ? `<tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Lieu</span>
        <span style="font-size:14px;">${p.eventLocation}</span>
      </td></tr>` : ""}
    </table>
    ${btn("Voir les détails", p.portalUrl)}`
  return {
    to:      p.email,
    subject: `Rappel — ${p.eventTitle} (${whenLabel})`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function adminWelcomeEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  loginUrl:        string
  trialDays:       number
}) {
  // trialDays: 0 means the account started on a paid custom-pricing offer instead of the
  // standard trial (see /api/register's offerToken branch) — no trial sentence to show.
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Bienvenue sur ${APP_NAME}, ${p.firstName} !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Votre association <strong>${p.associationName}</strong> a été créée avec succès.${p.trialDays > 0
        ? `<br>Vous disposez de <strong>${p.trialDays} jours d'essai gratuit</strong> pour découvrir toutes les fonctionnalités.`
        : ""}
    </p>
    ${btn("Accéder à mon tableau de bord", p.loginUrl)}
    <p style="margin:0;font-size:13px;color:#71717a;">Connectez-vous avec <strong>${p.email}</strong>.</p>`
  return {
    to:      p.email,
    subject: `Bienvenue sur ${APP_NAME} — ${p.associationName}`,
    html:    layout(APP_NAME, content),
  }
}

export function subscriptionPaymentFailedEmail(p: {
  email:           string
  associationName: string
  amount:          number | null
  attemptCount:    number
  nextAttemptAt:   Date | null
  billingUrl:      string
}) {
  const amountStr = p.amount != null
    ? p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
    : "—"
  const nextAttemptStr = p.nextAttemptAt
    ? p.nextAttemptAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Le paiement de votre abonnement a échoué</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Le prélèvement de <strong>${amountStr}</strong> pour l'abonnement ${APP_NAME} de
      <strong>${p.associationName}</strong> n'a pas pu être effectué${p.attemptCount > 1 ? ` (tentative n°${p.attemptCount})` : ""}.<br>
      ${nextAttemptStr
        ? `Un nouvel essai automatique aura lieu le <strong>${nextAttemptStr}</strong>.`
        : "Mettez à jour votre moyen de paiement dès que possible pour éviter une suspension de l'accès."}
    </p>
    ${btn("Mettre à jour mon moyen de paiement", p.billingUrl)}
    <p style="margin:0;font-size:13px;color:#71717a;">
      L'accès au tableau de bord sera suspendu si le paiement continue d'échouer.
    </p>`
  return {
    to:      p.email,
    subject: `Échec de paiement — ${p.associationName}`,
    html:    layout(APP_NAME, content),
  }
}

export function passwordResetEmail(p: {
  email:        string
  resetUrl:     string
  accountLabel: string
}) {
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Réinitialisation du mot de passe</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Vous avez demandé à réinitialiser le mot de passe associé à <strong>${p.email}</strong>
      pour le compte lié à <strong>${p.accountLabel}</strong>.<br>
      Si vous avez plusieurs comptes avec cet email, vous recevrez un lien distinct pour chacun —
      utilisez bien celui-ci pour réinitialiser ce compte précis.<br>
      Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
    </p>
    ${btn("Réinitialiser mon mot de passe", p.resetUrl)}
    <p style="margin:0;font-size:13px;color:#71717a;">
      Ce lien est valable <strong>1 heure</strong>. Si vous n'avez pas fait cette demande, ignorez cet email.
    </p>`
  return {
    to:      p.email,
    subject: `Réinitialisation de votre mot de passe ${APP_NAME} — ${p.accountLabel}`,
    html:    layout(APP_NAME, content),
  }
}

export function portalWelcomeEmail(p: {
  firstName:       string
  email:           string
  password:        string
  associationName: string
  loginUrl:        string
  branding?:       EmailBranding
  // Set when a default cotisation was auto-created for this member — surfaces it here
  // since it otherwise sits silently on their Cotisation tab until they think to check it.
  cotisation?: { amount: number; year: number }
}) {
  const cotisationNote = p.cotisation ? `
    <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#3f3f46;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;">
      Une cotisation ${p.cotisation.year} de <strong>${p.cotisation.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</strong> vous attend — réglable directement depuis votre espace membre, onglet « Cotisation ».
    </p>` : ""
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Bienvenue, ${p.firstName} !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Votre compte membre de <strong>${p.associationName}</strong> a été créé avec succès.<br>
      Voici vos identifiants de connexion :
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      <tr><td style="padding-bottom:10px;">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Email</span>
        <span style="font-size:14px;font-weight:600;">${p.email}</span>
      </td></tr>
      <tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Mot de passe temporaire</span>
        <span style="font-size:18px;font-weight:700;letter-spacing:2px;font-family:monospace;">${p.password}</span>
      </td></tr>
    </table>
    ${cotisationNote}
    ${btn("Accéder à mon espace membre", p.loginUrl)}
    <p style="margin:0;font-size:13px;color:#71717a;">
      Nous vous recommandons de modifier votre mot de passe après la première connexion.
    </p>`
  return {
    to:      p.email,
    subject: `Vos identifiants — Espace membre ${p.associationName}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function customEmail(p: {
  associationName: string
  subject:         string
  bodyHtml:        string
  recipientEmail:  string
  branding?:       EmailBranding
}) {
  return {
    to:      p.recipientEmail,
    subject: p.subject,
    html:    layout(p.associationName, p.bodyHtml, p.branding),
  }
}

// Emails sent by Formwise Support staff to an association's managers/members. Deliberately
// never passes `branding` — this must never appear to come from the association itself.
// Unlike customEmail() above, `bodyHtml` here is actually plain text from the backoffice
// composer's <textarea> (see support-email-composer.tsx) — escaped and wrapped in
// white-space:pre-wrap so line breaks survive and stray "<"/">" characters can't break the
// layout, matching the convention already used for support-ticket notification emails
// (supportTicketStaffEmail above).
export function supportEmail(p: {
  subject:        string
  bodyHtml:       string
  recipientEmail: string
}) {
  const content = `<div style="font-size:15px;line-height:1.6;color:#18181b;white-space:pre-wrap;">${escapeHtml(p.bodyHtml)}</div>`
  return {
    to:      p.recipientEmail,
    subject: p.subject,
    html:    layout("Support Formwise", content),
  }
}

export function ticketPurchaseEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  eventTitle:      string
  eventDate:       Date
  eventLocation:   string | null
  amount:          number
  quantity:        number
  paidAt:          Date
  portalUrl:       string
  // Only set for public/guest tickets (no portal account to cancel from) — see
  // src/app/api/public/cancel-ticket/[token]/route.ts.
  cancelUrl?:      string
  // Un QR d'entrée par billet de la commande — un seul pour les emails par participant
  // (commandes publiques), potentiellement plusieurs pour l'email combiné de l'acheteur
  // portail (son billet + ceux de ses invités, identifiés par `name`).
  ticketQrs?:      TicketQr[]
  branding?:       EmailBranding
}) {
  const dateStr   = p.eventDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const timeStr   = p.eventDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  const amountStr = Number(p.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const qtyLine   = p.quantity > 1 ? `<tr><td style="padding-bottom:10px;">
    <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Nombre de billets</span>
    <span style="font-size:14px;font-weight:600;">${p.quantity}</span>
  </td></tr>` : ""
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Billet confirmé !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>votre paiement a été accepté. Voici votre confirmation de billet.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      <tr><td style="padding-bottom:10px;">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Événement</span>
        <span style="font-size:15px;font-weight:600;">${p.eventTitle}</span>
      </td></tr>
      <tr><td style="padding-bottom:10px;">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Date</span>
        <span style="font-size:14px;">${dateStr} à ${timeStr}</span>
      </td></tr>
      ${p.eventLocation ? `<tr><td style="padding-bottom:10px;">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Lieu</span>
        <span style="font-size:14px;">${p.eventLocation}</span>
      </td></tr>` : ""}
      ${qtyLine}
      <tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Montant payé</span>
        <span style="font-size:16px;font-weight:700;">${amountStr}</span>
      </td></tr>
    </table>
    ${p.ticketQrs?.length ? ticketQrSection(p.ticketQrs) : ""}
    <p style="margin:0 0 16px;font-size:13px;color:#71717a;">Conservez cet email comme preuve d'achat.</p>
    ${btn("Voir mes événements", p.portalUrl)}
    ${p.cancelUrl ? `<p style="margin:0;font-size:12px;color:#71717a;">Un empêchement ? <a href="${p.cancelUrl}" style="color:#71717a;">Annuler et être remboursé</a>.</p>` : ""}`
  return {
    to:      p.email,
    subject: `Billet confirmé — ${p.eventTitle}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

// Standalone "here is your entry QR" email, for tickets that already got their
// confirmation email before QR codes existed (Participation.ticketToken was backfilled
// afterwards) — sent per event by the organizer from présences → "Envoyer les QR
// manquants" (/api/evenements/[id]/send-tickets).
export function ticketQrDeliveryEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  eventTitle:      string
  eventDate:       Date
  eventLocation:   string | null
  ticketQr:        TicketQr
  branding?:       EmailBranding
}) {
  const dateStr = p.eventDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const timeStr = p.eventDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Votre QR code d'entrée</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>votre inscription à « ${p.eventTitle} » est bien enregistrée.
      Voici le QR code d'entrée de votre billet — il vous sera demandé à l'entrée de l'événement.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      <tr><td style="padding-bottom:10px;">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Événement</span>
        <span style="font-size:15px;font-weight:600;">${p.eventTitle}</span>
      </td></tr>
      <tr><td style="padding-bottom:${p.eventLocation ? "10px" : "0"};">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Date</span>
        <span style="font-size:14px;">${dateStr} à ${timeStr}</span>
      </td></tr>
      ${p.eventLocation ? `<tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Lieu</span>
        <span style="font-size:14px;">${p.eventLocation}</span>
      </td></tr>` : ""}
    </table>
    ${ticketQrSection([p.ticketQr])}
    <p style="margin:0;font-size:13px;color:#71717a;">Conservez cet email — vous avez déjà reçu votre confirmation d'inscription, celui-ci contient uniquement votre QR code d'entrée.</p>`
  return {
    to:      p.email,
    subject: `Votre QR code d'entrée — ${p.eventTitle}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function cancellationConfirmationEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  eventTitle:      string
  refunded:        boolean
  amount?:         number
  branding?:       EmailBranding
}) {
  const amountStr = p.amount != null ? Number(p.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : null
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Inscription annulée</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>votre inscription à « ${p.eventTitle} » a bien été annulée.
    </p>
    ${p.refunded && amountStr ? `<p style="margin:0;font-size:14px;color:#3f3f46;">Un remboursement de <strong>${amountStr}</strong> a été initié — comptez quelques jours ouvrés pour qu'il apparaisse sur votre compte.</p>` : ""}`
  return {
    to:      p.email,
    subject: `Annulation confirmée — ${p.eventTitle}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function meetingInviteEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  meetingTitle:    string
  scheduledAt:     Date | null
  instant:         boolean
  portalUrl:       string
  branding?:       EmailBranding
}) {
  const whenStr = p.instant
    ? "maintenant"
    : p.scheduledAt
      ? p.scheduledAt.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) +
        " à " +
        p.scheduledAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
      : "prochainement"

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Vous êtes invité(e) à une réunion</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br><strong>${p.associationName}</strong> vous invite à participer à la réunion suivante.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      <tr><td style="padding-bottom:10px;">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Réunion</span>
        <span style="font-size:15px;font-weight:600;">${p.meetingTitle}</span>
      </td></tr>
      <tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Date</span>
        <span style="font-size:14px;">${whenStr}</span>
      </td></tr>
    </table>
    ${btn("Rejoindre la réunion", p.portalUrl)}`
  return {
    to:      p.email,
    subject: `Invitation — ${p.meetingTitle}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function donConfirmationEmail(p: {
  firstName:           string
  email:               string
  associationName:     string
  amount:              number
  paidAt:              Date
  canIssueTaxReceipts: boolean
  receiptNumber?:      string
  donorType?:          "INDIVIDUAL" | "COMPANY"
  // Set only when the tier's receiptMode is "PARTIAL" (e.g. a gala ticket where part of
  // the price pays for the meal received in return) — only this portion is fiscally
  // deductible, and the PDF receipt itself already shows this figure, not p.amount. The
  // email must say the same thing or it contradicts its own attachment.
  deductibleAmount?:   number
  branding?:           EmailBranding
}) {
  const amountStr = p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const dateStr   = p.paidAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })

  const isCompany   = p.donorType === "COMPANY"
  const isPartial   = p.deductibleAmount != null && p.deductibleAmount < p.amount
  const deductibleStr = isPartial ? p.deductibleAmount!.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : amountStr

  const receiptBlock = p.canIssueTaxReceipts
    ? `<p style="margin:16px 0 0;font-size:13px;color:#3f3f46;">
        Votre <strong>reçu fiscal</strong> ${p.receiptNumber ? `(n° ${p.receiptNumber}) ` : ""}est joint à cet email.
        ${isPartial ? `Seule une partie de votre don, <strong>${deductibleStr}</strong>, ouvre droit à réduction d'impôt — le solde correspond à une contrepartie reçue en échange de votre don. ` : ""}
        Conservez-le pour votre déclaration ${isCompany ? "fiscale" : "de revenus"} — il vous permet de bénéficier
        d'une réduction d'impôt ${isCompany
          ? "de <strong>60 %</strong>, dans la limite de 0,5 % de votre chiffre d'affaires HT (ou 20 000 € si ce montant est plus élevé) — Art. 238 bis du CGI."
          : "de <strong>75 % jusqu'à 1 000 €</strong>, puis 66 % (Art. 200 CGI)."}
        ${isPartial ? `sur les <strong>${deductibleStr}</strong> déductibles.` : ""}
      </p>`
    : ""

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Merci pour votre don !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>votre don à <strong>${p.associationName}</strong> a bien été reçu. Merci pour votre générosité !
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      <tr><td style="padding-bottom:10px;">
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Montant</span>
        <span style="font-size:20px;font-weight:700;">${amountStr}</span>
      </td></tr>
      <tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Date</span>
        <span style="font-size:14px;">${dateStr}</span>
      </td></tr>
    </table>
    ${receiptBlock}
    <p style="margin:16px 0 0;font-size:12px;color:#71717a;">Conservez cet email comme confirmation de votre don.</p>`

  return {
    to:      p.email,
    subject: `Confirmation de don — ${p.associationName}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

const INTERVAL_LABEL: Record<"MONTH" | "QUARTER" | "YEAR", string> = {
  MONTH: "mois", QUARTER: "trimestre", YEAR: "an",
}

export function donationSubscriptionStartedEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  amount:          number
  interval:        "MONTH" | "QUARTER" | "YEAR"
  cancelUrl:       string
  branding?:       EmailBranding
}) {
  const amountStr = p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Merci pour votre don régulier !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>votre don récurrent à <strong>${p.associationName}</strong> est activé. Merci pour votre soutien continu !
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      <tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Montant prélevé chaque ${INTERVAL_LABEL[p.interval]}</span>
        <span style="font-size:20px;font-weight:700;">${amountStr}</span>
      </td></tr>
    </table>
    <p style="margin:0 0 20px;font-size:13px;color:#71717a;">
      Un reçu de confirmation vous sera envoyé à chaque prélèvement. Vous pouvez arrêter ce don à tout moment.
    </p>
    ${btn("Arrêter ce don récurrent", p.cancelUrl)}`
  return {
    to:      p.email,
    subject: `Don récurrent activé — ${p.associationName}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function donationSubscriptionPaymentFailedEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  amount:          number
  nextAttemptAt:   Date | null
  cancelUrl:       string
  branding?:       EmailBranding
}) {
  const amountStr = p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const nextAttemptStr = p.nextAttemptAt
    ? p.nextAttemptAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Le prélèvement de votre don n'a pas abouti</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>le prélèvement de <strong>${amountStr}</strong> pour votre don récurrent à
      <strong>${p.associationName}</strong> n'a pas pu être effectué.<br>
      ${nextAttemptStr
        ? `Un nouvel essai automatique aura lieu le <strong>${nextAttemptStr}</strong> — vérifiez que votre moyen de paiement est à jour.`
        : "Vérifiez que votre moyen de paiement est à jour."}
    </p>
    ${btn("Arrêter ce don récurrent", p.cancelUrl)}`
  return {
    to:      p.email,
    subject: `Échec de prélèvement — ${p.associationName}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

// Sent once, right after handleCotisationSubscriptionCheckout creates the member's User —
// no password reminder (they chose it themselves on the public form, unlike the admin-
// generated one in invitationEmail).
export function membershipSubscriptionStartedEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  amount:          number
  loginUrl:        string
  branding?:       EmailBranding
  // Set only for a custom-duration MembershipTier (see MembershipTier.durationMonths) —
  // null/undefined/12 keeps the historical "chaque année" wording. Without this, a tier
  // billing every N<12 months would tell new members they're charged yearly, and the next
  // (actually N-month-later) charge would land looking like a billing mistake.
  durationMonths?: number | null
  // Same reasoning as membershipWelcomeEmail's own fields — see there.
  canIssueTaxReceipts?: boolean
  receiptMode?:         "NONE" | "FULL" | "PARTIAL"
  deductibleAmount?:    number
}) {
  const amountStr = p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const cadenceLabel = p.durationMonths && p.durationMonths !== 12
    ? `Cotisation prélevée tous les ${p.durationMonths} mois`
    : "Cotisation prélevée chaque année"
  const showReceiptNotice = p.canIssueTaxReceipts && p.receiptMode && p.receiptMode !== "NONE"
  const isPartial      = p.receiptMode === "PARTIAL" && p.deductibleAmount != null
  const deductibleStr  = isPartial ? p.deductibleAmount!.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : amountStr
  const receiptSentence = showReceiptNotice
    ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3f3f46;">
        ${isPartial
          ? `Seule une partie de votre cotisation, <strong>${deductibleStr}</strong>, ouvre droit à un reçu fiscal — le solde correspond à une contrepartie.`
          : `Votre cotisation ouvre droit à un <strong>reçu fiscal</strong>.`}
        Vous pourrez le télécharger depuis votre espace membre après chaque prélèvement.
      </p>`
    : ""
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Bienvenue chez ${p.associationName} !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>votre adhésion est activée et votre premier paiement a été reçu.
      Vous pouvez dès maintenant vous connecter à votre espace membre avec l'email et le mot
      de passe que vous avez choisis.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      <tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">${cadenceLabel}</span>
        <span style="font-size:20px;font-weight:700;">${amountStr}</span>
      </td></tr>
    </table>
    ${receiptSentence}
    ${btn("Accéder à mon espace membre", p.loginUrl)}`
  return {
    to:      p.email,
    subject: `Bienvenue chez ${p.associationName} !`,
    html:    layout(p.associationName, content, p.branding),
  }
}

// Sent for a MembershipForm signup that's active right away with no ongoing subscription
// behind it — a one-off paid tier, or a free tier under MembershipForm.validationMode
// IMMEDIATE. No password reminder, same reasoning as membershipSubscriptionStartedEmail.
export function membershipWelcomeEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  amount:          number
  // Set when a paid tier was settled offline (espèces/chèque/virement) — the Cotisation
  // stays EN_ATTENTE until an admin records the payment, so the wording can't claim it's
  // already been received the way the online/free branches can.
  offlinePending?:      boolean
  offlineInstructions?: string | null
  loginUrl:        string
  branding?:       EmailBranding
  // Full names of the other people registered in the same multi-registrant submission (see
  // consumeMembershipCheckoutDraft, "Ajouter un autre adhérent") — when set, the amount below
  // is the combined total for the whole group, not just this recipient, so it needs saying:
  // otherwise a visitor who paid once for 3 people sees one price with no explanation of why
  // it's higher than their own tier.
  otherRegistrants?: string[]
  // Snapshotted from MembershipTier.receiptMode/deductibleAmount at signup (see
  // checkout/route.ts and the webhook handlers) — mirrors donConfirmationEmail's own
  // isPartial/deductibleAmount reasoning. Unlike a Don, no PDF is generated yet at this
  // point (see recu-fiscal.ts — a Cotisation's receipt is only ever built on demand from
  // the portal), so this only announces eligibility, it never claims one is attached.
  canIssueTaxReceipts?: boolean
  receiptMode?:         "NONE" | "FULL" | "PARTIAL"
  deductibleAmount?:    number
}) {
  const amountStr = p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const statusSentence = p.offlinePending
    ? " Il vous reste à régler votre cotisation selon les instructions ci-dessous."
    : p.amount > 0 ? " et votre paiement a bien été reçu." : "."
  const groupSentence = p.otherRegistrants && p.otherRegistrants.length > 0
    ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3f3f46;">
        Ce montant couvre votre adhésion ainsi que celle de ${p.otherRegistrants.join(", ")}.
      </p>`
    : ""
  // Only announced once payment has actually settled (never for offlinePending, where
  // nothing's been received yet) and the association can even issue one at all.
  const showReceiptNotice = !p.offlinePending && p.amount > 0 && p.canIssueTaxReceipts
    && p.receiptMode && p.receiptMode !== "NONE"
  const isPartial      = p.receiptMode === "PARTIAL" && p.deductibleAmount != null
  const deductibleStr  = isPartial ? p.deductibleAmount!.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) : amountStr
  const receiptSentence = showReceiptNotice
    ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3f3f46;">
        ${isPartial
          ? `Seule une partie de votre cotisation, <strong>${deductibleStr}</strong>, ouvre droit à un reçu fiscal — le solde correspond à une contrepartie.`
          : `Votre cotisation ouvre droit à un <strong>reçu fiscal</strong>.`}
        Vous pourrez le télécharger depuis votre espace membre.
      </p>`
    : ""
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Bienvenue chez ${p.associationName} !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>votre adhésion est activée${statusSentence}
      Vous pouvez dès maintenant vous connecter à votre espace membre avec l'email et le mot
      de passe que vous avez choisis.
    </p>
    ${p.amount > 0 ? `<table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      <tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">${p.offlinePending ? "Montant à régler" : "Montant réglé"}</span>
        <span style="font-size:20px;font-weight:700;">${amountStr}</span>
      </td></tr>
    </table>` : ""}
    ${groupSentence}
    ${receiptSentence}
    ${p.offlinePending && p.offlineInstructions ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3f3f46;">${p.offlineInstructions}</p>` : ""}
    ${btn("Accéder à mon espace membre", p.loginUrl)}`
  return {
    to:      p.email,
    subject: `Bienvenue chez ${p.associationName} !`,
    html:    layout(p.associationName, content, p.branding),
  }
}

// Sent instead of membershipWelcomeEmail when MembershipForm.validationMode is "REQUEST" and
// the tier is free (see checkout/route.ts's willBeImmediate) — no User/password exists yet at
// this point, so unlike membershipWelcomeEmail there is no login link here: the account only
// gets created once an admin approves the request (see PATCH /api/membres/[id]'s isApproval
// branch, which sends its own invitationEmail with real credentials at that point).
export function membershipPendingValidationEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  formTitle:       string
  branding?:       EmailBranding
  // Same reasoning as membershipWelcomeEmail's own field — see there.
  otherRegistrants?: string[]
}) {
  const groupSentence = p.otherRegistrants && p.otherRegistrants.length > 0
    ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3f3f46;">
        Cette demande couvre également ${p.otherRegistrants.join(", ")}.
      </p>`
    : ""
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Demande bien reçue</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>votre demande d'adhésion à ${p.associationName} via « ${p.formTitle} »
      a bien été reçue. Elle est en attente de validation par un responsable de l'association —
      vous serez prévenu(e) par email dès qu'elle sera validée.
    </p>
    ${groupSentence}`
  return {
    to:      p.email,
    subject: `Votre demande d'adhésion à ${p.associationName} est en attente de validation`,
    html:    layout(p.associationName, content, p.branding),
  }
}

// Sent to MembershipForm.adminNotificationEmail (opt-in, per formulaire — see
// notifyMembershipSignup) each time someone joins through that specific form. Distinct from
// the in-app Notification every ADMIN/PRESIDENT/TRESORIER already gets regardless of this
// field: this is for a staff member who wants a real email the moment it happens, without
// having to be logged in or watching the notification bell.
export function membershipSignupAdminNotificationEmail(p: {
  email:           string
  associationName: string
  formTitle:       string
  memberNames:     string[] // 1 for a single registrant, N for a group submission
  amount:          number
  dashboardUrl:    string
  branding?:       EmailBranding
  // Set when this signup requires manual validation (MembershipForm.validationMode ===
  // "REQUEST") before it becomes a real Membre — see notifyMembershipSignup. Swaps the
  // wording from "joined" to "is waiting for your review" so this reads as an action item
  // rather than a done deal.
  pendingValidation?: boolean
}) {
  const amountStr = p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const namesStr  = p.memberNames.join(", ")
  const isGroup   = p.memberNames.length > 1
  const heading    = p.pendingValidation
    ? (isGroup ? "Demande d'inscription groupée à valider" : "Demande d'adhésion à valider")
    : (isGroup ? "Nouvelle inscription groupée" : "Nouvelle adhésion")
  const bodySentence = p.pendingValidation
    ? `${escapeHtml(namesStr)} ${isGroup ? "souhaitent rejoindre" : "souhaite rejoindre"} <strong>${escapeHtml(p.associationName)}</strong>
       via le formulaire « ${escapeHtml(p.formTitle)} » et ${isGroup ? "attendent" : "attend"} votre validation.`
    : `${escapeHtml(namesStr)} ${isGroup ? "ont rejoint" : "a rejoint"} <strong>${escapeHtml(p.associationName)}</strong>
       via le formulaire « ${escapeHtml(p.formTitle)} ».`
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">${heading}</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      ${bodySentence}
    </p>
    ${p.amount > 0 ? `<table cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;width:100%;box-sizing:border-box;">
      <tr><td>
        <span style="font-size:13px;color:#6b7280;display:block;margin-bottom:2px;">Montant</span>
        <span style="font-size:20px;font-weight:700;">${amountStr}</span>
      </td></tr>
    </table>` : ""}
    ${btn(p.pendingValidation ? "Valider la demande" : "Voir les membres", p.dashboardUrl)}`
  return {
    to:      p.email,
    subject: p.pendingValidation
      ? `Demande d'adhésion à valider · ${p.formTitle}`
      : (isGroup ? `Nouvelle inscription groupée · ${p.formTitle}` : `Nouvelle adhésion · ${p.formTitle}`),
    html:    layout(p.associationName, content, p.branding),
  }
}

export function cotisationSubscriptionPaymentFailedEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  amount:          number
  nextAttemptAt:   Date | null
  cancelUrl:       string
  branding?:       EmailBranding
}) {
  const amountStr = p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const nextAttemptStr = p.nextAttemptAt
    ? p.nextAttemptAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Le prélèvement de votre cotisation n'a pas abouti</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>le prélèvement de <strong>${amountStr}</strong> pour votre cotisation à
      <strong>${p.associationName}</strong> n'a pas pu être effectué.<br>
      ${nextAttemptStr
        ? `Un nouvel essai automatique aura lieu le <strong>${nextAttemptStr}</strong> — vérifiez que votre moyen de paiement est à jour.`
        : "Vérifiez que votre moyen de paiement est à jour."}
    </p>
    ${btn("Gérer mon adhésion", p.cancelUrl)}`
  return {
    to:      p.email,
    subject: `Échec de prélèvement — ${p.associationName}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

// Sent alongside cotisationSubscriptionPaymentFailedEmail to every director (ADMIN/
// PRESIDENT/TRESORIER) — the member-facing email alone leaves the association finding out
// only once the member happens to mention it, or not at all.
export function cotisationSubscriptionPaymentFailedAdminEmail(p: {
  email:           string
  associationName: string
  memberName:      string
  amount:          number
  dashboardUrl:    string
}) {
  const amountStr = p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Échec de prélèvement d'une cotisation</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Le prélèvement automatique de <strong>${amountStr}</strong> pour la cotisation de
      <strong>${p.memberName}</strong> n'a pas pu être effectué. Le membre a été prévenu et
      Stripe va retenter automatiquement.
    </p>
    ${btn("Voir les membres", p.dashboardUrl)}`
  return {
    to:      p.email,
    subject: `Échec de prélèvement — ${p.memberName}`,
    html:    layout(APP_NAME, content),
  }
}

// Mirrors cotisationSubscriptionPaymentFailedEmail exactly, for a "payer en plusieurs fois"
// installment charge instead of a genuine yearly renewal — see CotisationInstallmentPlan.
export function membershipInstallmentPaymentFailedEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  amount:          number
  installmentNumber: number
  installmentsCount: number
  nextAttemptAt:   Date | null
  cancelUrl:       string
  branding?:       EmailBranding
}) {
  const amountStr = p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const nextAttemptStr = p.nextAttemptAt
    ? p.nextAttemptAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : null
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Le prélèvement de votre mensualité n'a pas abouti</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>le prélèvement de <strong>${amountStr}</strong>
      (mensualité ${p.installmentNumber}/${p.installmentsCount}) pour votre adhésion à
      <strong>${p.associationName}</strong> n'a pas pu être effectué.<br>
      ${nextAttemptStr
        ? `Un nouvel essai automatique aura lieu le <strong>${nextAttemptStr}</strong> — vérifiez que votre moyen de paiement est à jour.`
        : "Vérifiez que votre moyen de paiement est à jour."}
    </p>
    ${btn("Gérer mon paiement en plusieurs fois", p.cancelUrl)}`
  return {
    to:      p.email,
    subject: `Échec de prélèvement — ${p.associationName}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

// Sent alongside membershipInstallmentPaymentFailedEmail to every director, same reasoning as
// cotisationSubscriptionPaymentFailedAdminEmail.
export function membershipInstallmentPaymentFailedAdminEmail(p: {
  email:           string
  associationName: string
  memberName:      string
  amount:          number
  installmentNumber: number
  installmentsCount: number
  dashboardUrl:    string
}) {
  const amountStr = p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Échec de prélèvement d'une mensualité</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Le prélèvement automatique de <strong>${amountStr}</strong> (mensualité
      ${p.installmentNumber}/${p.installmentsCount}) pour l'adhésion de
      <strong>${p.memberName}</strong> n'a pas pu être effectué. Le membre a été prévenu et
      Stripe va retenter automatiquement.
    </p>
    ${btn("Voir les membres", p.dashboardUrl)}`
  return {
    to:      p.email,
    subject: `Échec de prélèvement — ${p.memberName}`,
    html:    layout(APP_NAME, content),
  }
}

export function boutiqueConfirmationEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  totalAmount:     number
  paidAt:          Date
  items:           { name: string; quantity: number; unitPrice: number }[]
  portalUrl:       string
  branding?:       EmailBranding
}) {
  const totalStr = (p.totalAmount / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const dateStr  = p.paidAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })

  const rows = p.items.map(i => {
    const unitStr = (i.unitPrice / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
    return `<tr>
      <td style="padding:8px 0;font-size:14px;border-bottom:1px solid #f0f0f0;">${i.name}</td>
      <td style="padding:8px 0;font-size:14px;border-bottom:1px solid #f0f0f0;text-align:center;">${i.quantity}</td>
      <td style="padding:8px 0;font-size:14px;border-bottom:1px solid #f0f0f0;text-align:right;">${unitStr}</td>
    </tr>`
  }).join("")

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Commande confirmée !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${p.firstName},<br>votre commande auprès de <strong>${p.associationName}</strong> a bien été enregistrée.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;width:100%;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;box-sizing:border-box;">
      <thead>
        <tr>
          <th style="text-align:left;font-size:12px;color:#6b7280;font-weight:600;padding-bottom:8px;">Article</th>
          <th style="text-align:center;font-size:12px;color:#6b7280;font-weight:600;padding-bottom:8px;">Qté</th>
          <th style="text-align:right;font-size:12px;color:#6b7280;font-weight:600;padding-bottom:8px;">Prix</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="padding-top:12px;font-size:14px;font-weight:700;">Total</td>
          <td style="padding-top:12px;font-size:16px;font-weight:700;text-align:right;">${totalStr}</td>
        </tr>
      </tfoot>
    </table>
    <p style="margin:0 0 8px;font-size:13px;color:#71717a;">Payé le ${dateStr}. Conservez cet email comme confirmation.</p>
    ${btn("Voir mes commandes", p.portalUrl)}`

  return {
    to:      p.email,
    subject: `Confirmation de commande — ${p.associationName}`,
    html:    layout(p.associationName, content, p.branding),
  }
}

export function boutiqueNewOrderAdminEmail(p: {
  email:           string
  associationName: string
  buyerLabel:      string
  totalAmount:     number
  dashboardUrl:    string
}) {
  const totalStr = (p.totalAmount / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Nouvelle vente boutique</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      <strong>${p.buyerLabel}</strong> vient de passer une commande de <strong>${totalStr}</strong>
      sur la boutique de <strong>${p.associationName}</strong>.
    </p>
    ${btn("Voir la commande", p.dashboardUrl)}`
  return {
    to:      p.email,
    subject: `Nouvelle vente boutique — ${totalStr}`,
    html:    layout(APP_NAME, content),
  }
}

// Sent to SUPPORT_TEAM_EMAIL whenever an association creates or replies to a support ticket
// (see src/lib/support-tickets.ts). Branded as the platform (APP_NAME), not the association —
// this is an internal ops notification, not something sent on the association's behalf.
// subject/body/authorName/associationName are all admin-typed free text, escaped before
// interpolation (unlike some older templates in this file — see boutiqueNewOrderAdminEmail —
// this one takes no chances with it).
export function supportTicketStaffEmail(p: {
  to:              string
  associationName: string
  authorName:      string
  subject:         string
  body:            string
  ticketUrl:       string
  // Whether this message opened the ticket vs. was added to an existing one — the subject
  // line stays identical either way (deliberately, so a client threads them together), but
  // the body copy needs to say which one this is or "reply" reads as "brand-new" at a glance.
  isNewTicket:     boolean
}) {
  const heading = p.isNewTicket ? "Nouvelle demande support" : "Nouvelle réponse sur une demande support"
  const intro   = p.isNewTicket
    ? `<strong>${escapeHtml(p.authorName)}</strong> (${escapeHtml(p.associationName)}) a ouvert une nouvelle demande — objet : <strong>${escapeHtml(p.subject)}</strong>`
    : `<strong>${escapeHtml(p.authorName)}</strong> (${escapeHtml(p.associationName)}) a répondu sur la demande <strong>${escapeHtml(p.subject)}</strong> :`
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">${heading}</h2>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46;">${intro}</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-left:3px solid #e4e4e7;">
      <tr><td style="padding:4px 0 4px 16px;font-size:14px;line-height:1.6;color:#18181b;white-space:pre-wrap;">${escapeHtml(p.body)}</td></tr>
    </table>
    ${btn("Répondre", p.ticketUrl)}`
  return {
    to:      p.to,
    subject: `[Support] ${p.associationName} — ${p.subject}`,
    html:    layout(APP_NAME, content),
  }
}

// Sent to the ticket's author when the platform team replies (src/lib/support-tickets.ts).
// Same "platform-branded, not association-branded" reasoning as supportTicketStaffEmail — the
// reply is from Adhera's own team, not from the association itself.
export function supportTicketReplyEmail(p: {
  to:           string
  name:         string
  subject:      string
  body:         string
  dashboardUrl: string
}) {
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Nouvelle réponse à votre demande</h2>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Bonjour ${escapeHtml(p.name)}, l'équipe ${APP_NAME} a répondu à votre demande <strong>${escapeHtml(p.subject)}</strong> :
    </p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;border-left:3px solid #e4e4e7;">
      <tr><td style="padding:4px 0 4px 16px;font-size:14px;line-height:1.6;color:#18181b;white-space:pre-wrap;">${escapeHtml(p.body)}</td></tr>
    </table>
    ${btn("Voir la conversation", p.dashboardUrl)}`
  return {
    to:      p.to,
    subject: `Réponse à votre demande — ${p.subject}`,
    html:    layout(APP_NAME, content),
  }
}
