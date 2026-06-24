"use server"

import { signIn, signOut } from "@/lib/auth/config"
import { AuthError } from "next-auth"

type LoginState = { error?: string } | undefined

export async function authenticate(prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email       = formData.get("email")       as string
  const password    = formData.get("password")    as string
  const slug        = (formData.get("slug")        as string | null)?.trim() || null
  const callbackUrl = (formData.get("callbackUrl") as string | null)?.trim() || null

  const defaultRedirect = slug ? `/portal/${slug}/actualites` : "/dashboard"

  try {
    await signIn("credentials", { email, password, ...(slug ? { slug } : {}), redirectTo: callbackUrl ?? defaultRedirect })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Identifiants incorrects. Veuillez réessayer." }
    }
    throw error
  }
}

export async function logout(redirectTo = "/login") {
  await signOut({ redirectTo })
}
