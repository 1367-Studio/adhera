"use client"

import { useEffect, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { useRouter } from "next/navigation"
import { signOut } from "next-auth/react"
import { portalRegisterSchema, type PortalRegisterInput } from "@/lib/schemas"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr";
type MembreType = { id: string; name: string }

export function PortalRegisterForm({ slug }: { slug: string }) {
  const router = useRouter()
  const [types, setTypes] = useState<MembreType[]>([])

  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = useForm<PortalRegisterInput>({
    resolver: zodResolver(portalRegisterSchema),
    mode:     "onSubmit",
  })

  useEffect(() => {
    fetch(`/api/portal/${slug}/types`)
      .then(r => r.ok ? r.json() : [])
      .then(setTypes)
      .catch(() => {})
  }, [slug])

  async function onSubmit(data: PortalRegisterInput) {
    const res = await fetch("/api/portal/register", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ slug, ...data }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      toast.error(json.error ?? "Erreur lors de la création du compte")
      return
    }

    toast.success("Compte créé ! Vérifiez votre email pour recevoir vos identifiants.")
    await signOut({ redirect: false })
    router.push(`/portal/${slug}/login`)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="Prénom"
          placeholder="Jean"
          autoComplete="given-name"
          autoFocus
          required
          error={errors.firstName?.message}
          {...register("firstName")}
        />
        <FormField
          label="Nom"
          placeholder="Dupont"
          autoComplete="family-name"
          required
          error={errors.lastName?.message}
          {...register("lastName")}
        />
      </div>

      <FormField
        label="Adresse email"
        type="email"
        placeholder="jean.dupont@email.fr"
        autoComplete="email"
        required
        error={errors.email?.message}
        {...register("email")}
      />

      {types.length > 0 && (
        <Controller
          name="typeId"
          control={control}
          render={({ field }) => (
            <SelectField
              label="Type de membre"
              placeholder="Choisir un type…"
              options={types.map(t => ({ value: t.id, label: t.name }))}
              value={field.value}
              onValueChange={field.onChange}
              error={errors.typeId?.message}
            />
          )}
        />
      )}

      <Button type="submit" className="w-full mt-2" disabled={isSubmitting}>
        {isSubmitting && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
        Créer mon compte
      </Button>
    </form>
  )
}
