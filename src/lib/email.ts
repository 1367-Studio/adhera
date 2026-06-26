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
              Email automatique envoyé par ${associationName} via Adhéra.<br>
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
}) {
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Bienvenue sur Adhéra, ${p.firstName} !</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Votre association <strong>${p.associationName}</strong> a été créée avec succès.<br>
      Vous disposez de <strong>20 jours d'essai gratuit</strong> pour découvrir toutes les fonctionnalités.
    </p>
    ${btn("Accéder à mon tableau de bord", p.loginUrl)}
    <p style="margin:0;font-size:13px;color:#71717a;">Connectez-vous avec <strong>${p.email}</strong>.</p>`
  return {
    to:      p.email,
    subject: `Bienvenue sur Adhéra — ${p.associationName}`,
    html:    layout("Adhéra", content),
  }
}

export function passwordResetEmail(p: {
  email:    string
  resetUrl: string
}) {
  const content = `
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;">Réinitialisation du mot de passe</h2>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3f46;">
      Vous avez demandé à réinitialiser le mot de passe associé à <strong>${p.email}</strong>.<br>
      Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe.
    </p>
    ${btn("Réinitialiser mon mot de passe", p.resetUrl)}
    <p style="margin:0;font-size:13px;color:#71717a;">
      Ce lien est valable <strong>1 heure</strong>. Si vous n'avez pas fait cette demande, ignorez cet email.
    </p>`
  return {
    to:      p.email,
    subject: "Réinitialisation de votre mot de passe Adhéra",
    html:    layout("Adhéra", content),
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
}) {
  const amountStr = p.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const dateStr   = p.paidAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })

  const receiptBlock = p.canIssueTaxReceipts
    ? `<p style="margin:16px 0 0;font-size:13px;color:#3f3f46;">
        Votre <strong>reçu fiscal</strong> ${p.receiptNumber ? `(n° ${p.receiptNumber}) ` : ""}est joint à cet email.
        Conservez-le pour votre déclaration de revenus — il vous permet de bénéficier d'une réduction d'impôt
        de <strong>75 % jusqu'à 1 000 €</strong>, puis 66 % (Art. 200 CGI).
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
