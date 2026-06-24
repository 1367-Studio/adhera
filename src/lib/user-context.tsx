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

const UserContext    = createContext<SessionUser | null>(null)
const ModulesContext = createContext<AssocModules>(DEFAULT_MODULES)

export function UserProvider({
  user,
  modules,
  children,
}: {
  user:     SessionUser
  modules?: AssocModules
  children: React.ReactNode
}) {
  return (
    <UserContext.Provider value={user}>
      <ModulesContext.Provider value={modules ?? DEFAULT_MODULES}>
        {children}
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

export function isManager(role: string) {
  return ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"].includes(role)
}
