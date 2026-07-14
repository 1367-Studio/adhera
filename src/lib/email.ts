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

function layout(associationName: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;color:#111;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr>
          <td style="background:#000;padding:24px 40px;">
            <span style="color:#fff;font-size:17px;font-weight:700;letter-spacing:-0.3px;">${associationName}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
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
    <tr><td style="border-radius:6px;background:#000;">
      <a href="${url}" style="display:inline-block;padding:12px 28px;color:#fff;font-size:14px;font-weight:600;text-decoration:none;">${label}</a>
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
    html:    layout(p.associationName, content),
  }
}

export function invitationEmail(p: {
  firstName:       string
  email:           string
  password:        string
  associationName: string
  role:            string
  loginUrl:        string
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

  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Bienvenue, ${p.firstName} !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">${context}</p>
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
    html:    layout(p.associationName, content),
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
    ${btn("Voir l'événement", p.portalUrl)}`
  return {
    to:      p.email,
    subject: `Confirmation — ${p.eventTitle}`,
    html:    layout(p.associationName, content),
  }
}

export function checkInReceiptEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  eventTitle:      string
  eventDate:       Date
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
    html:    layout(p.associationName, content),
  }
}

export function paymentConfirmationEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  amount:          number | null
  period:          string | null
  paidAt:          Date
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
    html:    layout(p.associationName, content),
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
    html:    layout(p.associationName, content),
  }
}

export function adminWelcomeEmail(p: {
  firstName:       string
  email:           string
  associationName: string
  loginUrl:        string
  trialDays:       number
}) {
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Bienvenue sur ${APP_NAME}, ${p.firstName} !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Votre association <strong>${p.associationName}</strong> a été créée avec succès.<br>
      Vous disposez de <strong>${p.trialDays} jours d'essai gratuit</strong> pour découvrir toutes les fonctionnalités.
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
}) {
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
    ${btn("Accéder à mon espace membre", p.loginUrl)}
    <p style="margin:0;font-size:13px;color:#71717a;">
      Nous vous recommandons de modifier votre mot de passe après la première connexion.
    </p>`
  return {
    to:      p.email,
    subject: `Vos identifiants — Espace membre ${p.associationName}`,
    html:    layout(p.associationName, content),
  }
}

export function customEmail(p: {
  associationName: string
  subject:         string
  bodyHtml:        string
  recipientEmail:  string
}) {
  return {
    to:      p.recipientEmail,
    subject: p.subject,
    html:    layout(p.associationName, p.bodyHtml),
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
    <p style="margin:0 0 16px;font-size:13px;color:#71717a;">Conservez cet email comme preuve d'achat.</p>
    ${btn("Voir mes événements", p.portalUrl)}`
  return {
    to:      p.email,
    subject: `Billet confirmé — ${p.eventTitle}`,
    html:    layout(p.associationName, content),
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
    html:    layout(p.associationName, content),
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
}) {
  const amountStr = p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const dateStr   = p.paidAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })

  const isCompany = p.donorType === "COMPANY"

  const receiptBlock = p.canIssueTaxReceipts
    ? `<p style="margin:16px 0 0;font-size:13px;color:#3f3f46;">
        Votre <strong>reçu fiscal</strong> ${p.receiptNumber ? `(n° ${p.receiptNumber}) ` : ""}est joint à cet email.
        Conservez-le pour votre déclaration ${isCompany ? "fiscale" : "de revenus"} — il vous permet de bénéficier
        d'une réduction d'impôt ${isCompany
          ? "de <strong>60 %</strong>, dans la limite de 0,5 % de votre chiffre d'affaires HT (ou 20 000 € si ce montant est plus élevé) — Art. 238 bis du CGI."
          : "de <strong>75 % jusqu'à 1 000 €</strong>, puis 66 % (Art. 200 CGI)."}
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
    html:    layout(p.associationName, content),
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
    html:    layout(p.associationName, content),
  }
}
