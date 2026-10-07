// Fixed French UI chrome rendered around association-authored content on a public site — the
// navbar/footer/cookie banner (never built with Puck fields, so BLOCK_TRANSLATABLE_FIELDS in
// site-puck-translate.ts can't reach it) and the small labels the Formwise content blocks
// (events/actualités/boutique) render around their live data.
//
// Pure data, deliberately with no server-only imports: site-navbar.tsx, site-builder-footer.tsx,
// site-cookie-consent.tsx and site-block-translate.tsx are "use client" components that import
// this file directly — pulling in translateFields (and, through it, the Postgres driver) here
// would break their client bundle. The translation itself (BYOK-then-Azure, same as everything
// else) lives in site-ui-strings-translate.ts, imported only from server code.
export const SITE_UI_STRINGS = {
  navAdherer:             "Adhérer",
  navSeConnecter:         "Se connecter",
  footerRights:           "Tous droits réservés.",
  footerPoweredBy:        "Propulsé par",
  footerAriaLabel:        "Pied de page",
  cookieTitle:            "Cookies",
  cookiePrivacyPolicy:    "Politique de confidentialité",
  cookieRefuse:           "Refuser",
  cookieAccept:           "Accepter",
  cookieManage:           "Gérer les cookies",
  cookieDefaultMessage:   "Ce site utilise des contenus tiers (vidéos…) susceptibles de déposer des cookies. Vous pouvez les accepter ou les refuser.",
  eventsSeeAll:           "Voir tous les événements",
  eventsDefaultTitle:     "Prochains événements",
  eventsPriceFrom:        "À partir de",
  actualitesFeaturedBadge: "À la une",
  actualitesSeeAll:       "Toutes les actualités",
  actualitesDefaultTitle: "Actualités",
  boutiqueDefaultTitle:   "Boutique",
  boutiqueSeeAll:         "Voir la boutique",
} as const

export type SiteUiStringKey = keyof typeof SITE_UI_STRINGS
export type SiteUiStrings   = Record<SiteUiStringKey, string>
