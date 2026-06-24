export type SectionType = "hero" | "about" | "events" | "actualites" | "membership" | "contact"

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
  contact:    "Contact",
}
