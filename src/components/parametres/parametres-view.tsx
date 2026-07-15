"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { BuildingsIcon, CreditCardIcon, LightningIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import { associationSchema, type AssociationInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { ViewToggle } from "@/components/ui/view-toggle"
import { FormField } from "@/components/ui/form-field"
import { Button } from "@/components/ui/button"
import { apiErrorMessage } from "@/lib/api-error"
import { useCurrentUser, useModules } from "@/lib/user-context"
import { MembreTypesManager } from "@/components/parametres/membre-types-manager"
import { PortalLinkSettings } from "@/components/parametres/portal-link-settings"
import { AiSettings } from "@/components/ai/ai-settings"
import { SmsSettings } from "@/components/sms/sms-settings"
import { LiveKitSettings } from "@/components/reunions/livekit-settings"
import { StripeConnectSettings } from "@/components/parametres/stripe-connect-settings"
import { IdentityDonsSettings } from "@/components/parametres/identity-dons-settings"
import { BillingSettings } from "@/components/parametres/billing-settings"
import { BrandingSettings } from "@/components/parametres/branding-settings"
type Association = {
  id:      string
  name:    string
  slug:    string
  city:    string | null
  country: string
  plan:    "ESSENTIAL" | "PRO"
  customBrandingEnabled: boolean | null
  logoUrl:        string | null
  primaryColor:   string | null
  secondaryColor: string | null
}

type Tab = "general" | "paiements" | "abonnement" | "integrations"

const ALL_TABS = [
  { value: "general"      as Tab, label: "Général",      icon: <BuildingsIcon   className="size-3.5" />, modules: null            },
  { value: "paiements"    as Tab, label: "Paiements",    icon: <CreditCardIcon className="size-3.5" />, modules: ["dons"]        },
  { value: "abonnement"   as Tab, label: "Abonnement",   icon: <ReceiptIcon     className="size-3.5" />, modules: null            },
  { value: "integrations" as Tab, label: "Intégrations", icon: <LightningIcon        className="size-3.5" />, modules: ["ia", "sms"]  },
] as const

const ADMINS = ["ADMIN", "PRESIDENT"]

export function ParametresView() {
  return (
    <Suspense fallback={null}>
      <ParametresViewInner />
    </Suspense>
  )
}

// useSearchParams() (pour revenir sur l'onglet Abonnement après le Customer Portal
// Stripe) exige une limite Suspense au-dessus, sous peine d'échec du prerendering.
function ParametresViewInner() {
  const { role } = useCurrentUser()
  const modules  = useModules()
  const canEdit  = ADMINS.includes(role)
  const qc       = useQueryClient()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const fromUrl = searchParams.get("tab")
    return (ALL_TABS.some(t => t.value === fromUrl) ? fromUrl : "general") as Tab
  })

  const tabs = ALL_TABS.filter(t => !t.modules || t.modules.some(m => modules[m]))

  useEffect(() => {
    if (!tabs.some(t => t.value === tab)) setTab("general")
  }, [tabs, tab])

  const { data: assoc, isLoading } = useQuery<Association>({
    queryKey: ["association"],
    queryFn:  async () => {
      const res = await fetch("/api/association")
      if (!res.ok) throw new Error("Erreur")
      return res.json()
    },
  })

  const { register, handleSubmit, reset, formState: { errors, isDirty, isSubmitting } } = useForm<AssociationInput>({
    resolver:      zodResolver(associationSchema),
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

  return (
    <div className="space-y-6 py-4">
      <PageHeader
        title="Paramètres"
        description="Configuration de votre association"
        action={<ViewToggle options={tabs} value={tab} onChange={setTab} />}
      />

      {/* ── Général ───────────────────────────────────────────────────── */}
      {tab === "general" && (
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-6">
            <h3 className="text-sm font-semibold mb-4">Informations de l'association</h3>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2].map(i => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
              </div>
            ) : (
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
            )}
          </div>

          {assoc && (
            <div className="rounded-xl border bg-card p-6">
              <BrandingSettings
                canEdit={canEdit}
                canUse={assoc.customBrandingEnabled ?? assoc.plan === "PRO"}
                data={{ logoUrl: assoc.logoUrl, primaryColor: assoc.primaryColor, secondaryColor: assoc.secondaryColor }}
              />
            </div>
          )}

          <MembreTypesManager canEdit={canEdit} />

          {assoc?.slug && (
            <div className="rounded-xl border bg-card p-6">
              <PortalLinkSettings slug={assoc.slug} />
            </div>
          )}
        </div>
      )}

      {/* ── Paiements ─────────────────────────────────────────────────── */}
      {tab === "paiements" && (
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-6">
            <StripeConnectSettings canEdit={canEdit} />
          </div>
          <div className="rounded-xl border bg-card p-6">
            <IdentityDonsSettings canEdit={canEdit} />
          </div>
        </div>
      )}

      {/* ── Abonnement ────────────────────────────────────────────────── */}
      {tab === "abonnement" && (
        <div className="space-y-6">
          <div className="rounded-xl border bg-card p-6">
            <BillingSettings canEdit={canEdit} />
          </div>
        </div>
      )}

      {/* ── Intégrations ──────────────────────────────────────────────── */}
      {tab === "integrations" && (
        <div className="space-y-6">
          {modules.ia && (
            <div className="rounded-xl border bg-card p-6">
              <AiSettings canEdit={canEdit} />
            </div>
          )}
          {modules.sms && (
            <div className="rounded-xl border bg-card p-6">
              <SmsSettings canEdit={canEdit} />
            </div>
          )}
          {modules.reunions && (
            <div className="rounded-xl border bg-card p-6">
              <LiveKitSettings canEdit={canEdit} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
