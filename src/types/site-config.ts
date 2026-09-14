export type SectionType = "hero" | "about" | "events" | "actualites" | "membership" | "dons" | "boutique" | "contact"

export type HeroSection = {
  id:          string
  type:        "hero"
  title:       string
  subtitle:    string
  bgColor?:    string
  image?:      string
  heroHeight?: "full" | "half"
}

export type AboutSection = {
  id:      string
  type:    "about"
  title:   string
  content: string
}

export type EventsSection = {
  id:    string
  type:  "events"
  title: string
  limit: number
}

export type ActualitesSection = {
  id:    string
  type:  "actualites"
  title: string
  limit: number
}

export type MembershipSection = {
  id:    string
  type:  "membership"
  title: string
  body:  string
}

// Renvoie vers le DonationForm explicitement lié à cette section (DonationForm.siteSectionId,
// choisi dans l'étape Publication du formulaire — voir dashboard/dons/[id]/page.tsx), ou vers
// /portal/[slug]/don, l'ancienne page de don standalone (accessible sans compte — voir
// src/proxy.ts) quand aucun formulaire n'est lié. Volontairement un simple appel à l'action et
// non un formulaire inline ici : le rendu réel (paliers, visuel, reçu fiscal) vit dans la page
// du DonationForm ou dans l'ancienne page standalone, jamais dupliqué dans ce composant.
export type DonsSection = {
  id:          string
  type:        "dons"
  title:       string
  body:        string
  buttonLabel?: string
}

export type BoutiqueSection = {
  id:    string
  type:  "boutique"
  title: string
  limit: number
}

export type ContactSection = {
  id:    string
  type:  "contact"
  title: string
}

export type SiteSection =
  | HeroSection
  | AboutSection
  | EventsSection
  | ActualitesSection
  | MembershipSection
  | DonsSection
  | BoutiqueSection
  | ContactSection

export type FooterLink = { label: string; url: string }

export type SiteConfig = {
  sections:           SiteSection[]
  primaryColor:       string
  logoUrl:            string
  // header
  headerBgColor?:      string
  headerShowMembres?:  boolean
  headerShowRegister?: boolean
  // footer
  footerText:         string
  footerBgColor?:     string
  footerLinks?:       FooterLink[]
}

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  sections:     [],
  primaryColor: "#6366f1",
  logoUrl:      "",
  footerText:   "",
}

export const SECTION_LABELS: Record<SectionType, string> = {
  hero:       "Bannière principale",
  about:      "À propos",
  events:     "Prochains événements",
  actualites: "Actualités",
  membership: "Rejoindre l'association",
  dons:       "Faire un don",
  boutique:   "Boutique",
  contact:    "Contact",
}
