"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { associationSchema, type AssociationInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { FormField } from "@/components/ui/form-field"
import { Button } from "@/components/ui/button"
import { apiErrorMessage } from "@/lib/api-error"
import { useCurrentUser } from "@/lib/user-context"
import { MembreTypesManager } from "@/components/parametres/membre-types-manager"
import { PortalLinkSettings } from "@/components/parametres/portal-link-settings"
import { AiSettings } from "@/components/ai/ai-settings"
import { StripeConnectSettings } from "@/components/parametres/stripe-connect-settings"

type Association = {
  id:      string
  name:    string
  slug:    string
  city:    string | null
  country: string
}

const ADMINS = ["ADMIN", "PRESIDENT"]

export function ParametresView() {
  const { role } = useCurrentUser()
  const canEdit   = ADMINS.includes(role)
  const qc        = useQueryClient()

  const { data: assoc, isLoading } = useQuery<Association>({
    queryKey: ["association"],
    queryFn:  async () => {
      const res = await fetch("/api/association")
      if (!res.ok) throw new Error("Erreur")
      return res.json()
    },
  })

  const { register, handleSubmit, reset, formState: { errors, isDirty, isSubmitting } } = useForm<AssociationInput>({
    resolver: zodResolver(associationSchema),
    defaultValues: { name: "", city: "", country: "France" },
  })

  useEffect(() => {
    if (assoc) reset({ name: assoc.name, city: assoc.city ?? "", country: assoc.country })
  }, [assoc, reset])

  const updateMutation = useMutation({
    mutationFn: async (data: AssociationInput) => {
      const res = await fetch("/api/association", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["association"] })
      qc.invalidateQueries({ queryKey: ["activity-logs"] })
      toast.success("Paramètres enregistrés")
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  if (isLoading) {
    return (
      <div className="space-y-4 py-4">
        <div className="h-8 w-48 rounded-lg bg-muted animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <div className="rounded-xl border bg-card p-6 space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
          </div>
          <div className="rounded-xl border bg-card p-6 space-y-3">
            {[1,2].map(i => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 py-4">
      <PageHeader
        title="Paramètres"
        description="Configuration de votre association"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Association */}
        <div className="rounded-xl border bg-card p-6">
          <h3 className="text-sm font-semibold mb-4">Informations de l'association</h3>

          <form onSubmit={handleSubmit(d => updateMutation.mutate(d))} className="space-y-4" noValidate>
            <FormField
              label="Nom de l'association"
              required
              disabled={!canEdit}
              error={errors.name?.message}
              {...register("name")}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                label="Ville"
                disabled={!canEdit}
                placeholder="Paris"
                error={errors.city?.message}
                {...register("city")}
              />
              <FormField
                label="Pays"
                required
                disabled={!canEdit}
                error={errors.country?.message}
                {...register("country")}
              />
            </div>

            {canEdit && (
              <Button type="submit" size="sm" disabled={!isDirty} loading={isSubmitting || updateMutation.isPending}>
                Enregistrer
              </Button>
            )}
          </form>
        </div>

        {/* Types de membres */}
        <MembreTypesManager canEdit={canEdit} />
      </div>

      {/* Portail */}
      {assoc?.slug && (
        <div className="rounded-xl border bg-card p-6">
          <PortalLinkSettings slug={assoc.slug} />
        </div>
      )}

      {/* Stripe Connect */}
      <div className="rounded-xl border bg-card p-6">
        <StripeConnectSettings canEdit={canEdit} />
      </div>

      {/* IA */}
      <div className="rounded-xl border bg-card p-6">
        <AiSettings canEdit={canEdit} />
      </div>
    </div>
  )
}
