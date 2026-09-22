"use client"

import { createContext, useContext } from "react"
import { type AssocModules, DEFAULT_MODULES } from "@/lib/modules"

export type SessionUser = {
  id:               string
  name?:            string | null
  email?:           string | null
  role:             string
  associationId?:   string | null
  associationSlug?: string | null
}

// Already resolved against the Pro gate by the layout (see resolveDocumentBranding() in
// src/lib/plan-limits.ts) — logoUrl is null whenever the association isn't entitled, so
// components reading this never need to know about plans.
export type Branding = {
  name:    string
  logoUrl: string | null
}

const UserContext              = createContext<SessionUser | null>(null)
const ModulesContext           = createContext<AssocModules>(DEFAULT_MODULES)
const BrandingContext          = createContext<Branding | null>(null)
// Association.memberCardSettings.enabled, resolved by the layout. Its own context rather than
// a module flag because the card is not a module: the cotisations module makes it possible,
// this switch makes it exist (same pair the portal sidebar applies — see PORTAL_NAV_ORDER).
// Defaults to false, so a provider that doesn't pass it never offers a card the association
// may not have.
const MemberCardEnabledContext = createContext<boolean>(false)

export function UserProvider({
  user,
  modules,
  branding,
  memberCardEnabled,
  children,
}: {
  user:               SessionUser
  modules?:           AssocModules
  branding?:          Branding | null
  memberCardEnabled?: boolean
  children:           React.ReactNode
}) {
  return (
    <UserContext.Provider value={user}>
      <ModulesContext.Provider value={modules ?? DEFAULT_MODULES}>
        <BrandingContext.Provider value={branding ?? null}>
          <MemberCardEnabledContext.Provider value={memberCardEnabled ?? false}>
            {children}
          </MemberCardEnabledContext.Provider>
        </BrandingContext.Provider>
      </ModulesContext.Provider>
    </UserContext.Provider>
  )
}

export function useCurrentUser(): SessionUser {
  const ctx = useContext(UserContext)
  if (!ctx) throw new Error("useCurrentUser must be used inside UserProvider")
  return ctx
}

export function useModules(): AssocModules {
  return useContext(ModulesContext)
}

export function useBranding(): Branding | null {
  return useContext(BrandingContext)
}

/** Whether this association offers the member card at all — see MemberCardEnabledContext. */
export function useMemberCardEnabled(): boolean {
  return useContext(MemberCardEnabledContext)
}

export function isManager(role: string) {
  return ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"].includes(role)
}
