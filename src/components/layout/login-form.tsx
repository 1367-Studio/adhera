"use client"

import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { authenticate } from "@/lib/auth/actions"
import { loginSchema, type LoginInput } from "@/lib/schemas"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { LoaderCircleIcon } from "lucide-react"

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
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
        {isSubmitting && <LoaderCircleIcon className="mr-2 size-4 animate-spin" />}
        Se connecter
      </Button>
    </form>
  )
}
