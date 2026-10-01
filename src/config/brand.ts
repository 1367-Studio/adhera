export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Formwise"

// Public marketing site, linked from every association website ("Propulsé par Formwise").
// The utm parameters let the marketing site count visitors coming from association sites.
export const MARKETING_SITE_URL = process.env.NEXT_PUBLIC_MARKETING_SITE_URL || "https://www.formwise.fr"
export const POWERED_BY_LINK = `${MARKETING_SITE_URL}/?utm_source=association-site&utm_medium=footer&utm_campaign=powered-by`
