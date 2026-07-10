"use client"

import { Suspense, useEffect, useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { useRouter, useSearchParams } from "next/navigation"
import { signOut } from "next-auth/react"
import { signInWithGooglePortal } from "@/lib/auth/actions"
import { portalRegisterSchema, type PortalRegisterInput } from "@/lib/schemas"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { PRIVACY_URL } from "@/lib/consent"
import { CircleNotchIcon } from "@phosphor-icons/react/dist/ssr";
type MembreType = { id: string; name: string }

export function PortalRegisterForm({ slug }: { slug: string }) {
  return (
    <Suspense fallback={null}>
      <PortalRegisterFormInner slug={slug} />
    </Suspense>
  )
}

// useSearchParams() (for the Google prefill, arriving via /portal/[slug]/register?g_name=
// &g_email= — see the signIn callback in src/lib/auth/config.ts) requires a Suspense
// boundary above it, same reasoning as the dashboard's register-form.tsx.
function PortalRegisterFormInner({ slug }: { slug: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [types, setTypes] = useState<MembreType[]>([])

  const gName  = searchParams.get("g_name")  ?? ""
  const gEmail = searchParams.get("g_email") ?? ""
  const [firstName, ...gLastNameParts] = gName.trim().split(/\s+/)

  const { register, control, handleSubmit, formState: { errors, isSubmitting } } = useForm<PortalRegisterInput>({
    resolver:      zodResolver(portalRegisterSchema),
    mode:          "onSubmit",
    defaultValues: gName || gEmail
      ? { firstName: firstName || "", lastName: gLastNameParts.join(" "), email: gEmail }
      : undefined,
  })

  useEffect(() => {
    fetch(`/api/portal/${slug}/types`)
      .then(r => r.ok ? r.json() : [])
      .then(setTypes)
      .catch(() => {})
  }, [slug])

  // Arrived here via "Continuer avec Google" on the login page — that button doesn't
  // finish the sign-in itself for a first-time member (see the signIn callback in
  // src/lib/auth/config.ts): it can't create the account without this consent step in
  // between, so it redirects here instead. Once the account exists, re-triggering Google
  // completes the sign-in for real — without this, everyone who clicked "Google" would be
  // funneled into a password-based login instead, which defeats the point of that button.
  const viaGoogle = !!gEmail

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

    if (viaGoogle && data.email.toLowerCase() === gEmail.toLowerCase()) {
      toast.success("Compte créé !")
      await signInWithGooglePortal(slug)
      return
    }

    toast.success("Compte créé ! Vérifiez votre email pour recevoir vos identifiants.")
    await signOut({ redirect: false })
    router.push(`/portal/${slug}/login`)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {viaGoogle && (
        <p className="text-xs text-muted-foreground">
          Vous continuez avec Google. Confirmez vos informations pour terminer la création de votre compte.
        </p>
      )}

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

      <CheckboxField
        id="portal-accepted-terms"
        label={
          <>
            J&apos;accepte que mes données soient traitées conformément à la{" "}
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">
              politique de confidentialité
            </a>
          </>
        }
        error={errors.acceptedTerms?.message}
        {...register("acceptedTerms")}
      />

      <Button type="submit" className="w-full mt-2" disabled={isSubmitting}>
        {isSubmitting && <CircleNotchIcon className="mr-2 size-4 animate-spin" />}
        Créer mon compte
      </Button>
    </form>
  )
}
