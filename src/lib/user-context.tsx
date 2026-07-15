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
// src/lib/plan-limits.ts) — logoUrl/primaryColor are null whenever the association isn't
// entitled, so components reading this never need to know about plans.
export type Branding = {
  name:           string
  logoUrl:        string | null
  primaryColor:   string | null
  secondaryColor: string | null
}

const UserContext     = createContext<SessionUser | null>(null)
const ModulesContext  = createContext<AssocModules>(DEFAULT_MODULES)
const BrandingContext = createContext<Branding | null>(null)

export function UserProvider({
  user,
  modules,
  branding,
  children,
}: {
  user:      SessionUser
  modules?:  AssocModules
  branding?: Branding | null
  children:  React.ReactNode
}) {
  return (
    <UserContext.Provider value={user}>
      <ModulesContext.Provider value={modules ?? DEFAULT_MODULES}>
        <BrandingContext.Provider value={branding ?? null}>
          {children}
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

export function isManager(role: string) {
  return ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"].includes(role)
}
