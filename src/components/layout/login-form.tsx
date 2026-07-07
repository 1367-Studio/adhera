"use client"

import Link from "next/link"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { authenticate, signInWithGoogleDashboard } from "@/lib/auth/actions"
import { loginSchema, type LoginInput } from "@/lib/schemas"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { GoogleIcon } from "@/components/icons/google-icon"
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr";
export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [googleLoading, setGoogleLoading] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    mode: "onSubmit",
  })

  async function onSubmit(data: LoginInput) {
    const formData = new FormData()
    formData.append("email", data.email)
    formData.append("password", data.password)
    if (callbackUrl) formData.append("callbackUrl", callbackUrl)

    const result = await authenticate(undefined, formData)
    if (result?.error) toast.error(result.error)
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    try {
      await signInWithGoogleDashboard()
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField
        label="Adresse email"
        type="email"
        placeholder="contact@association.fr"
        autoComplete="email"
        autoFocus
        required
        error={errors.email?.message}
        {...register("email")}
      />

      <FormField
        label="Mot de passe"
        type="password"
        placeholder="••••••••"
        autoComplete="current-password"
        required
        error={errors.password?.message}
        labelAction={
          <Link
            href="/forgot-password"
            className="underline underline-offset-4 hover:text-foreground transition-colors"
          >
            Mot de passe oublié ?
          </Link>
        }
        {...register("password")}
      />

      <Button type="submit" className="w-full mt-2" disabled={isSubmitting}>
        {isSubmitting && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
        Se connecter
      </Button>

      <div className="relative flex items-center gap-2 py-1">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground/60 shrink-0">ou</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={googleLoading}
        onClick={handleGoogle}
      >
        {googleLoading
          ? <CircleNotchIcon className="mr-2 size-4 animate-spin" />
          : <GoogleIcon className="mr-2 size-4" />
        }
        Continuer avec Google
      </Button>
    </form>
  )
}
