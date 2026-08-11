"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
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
import { BankSettings } from "@/components/parametres/bank-settings"
import { CotisationDefaultsSettings } from "@/components/parametres/cotisation-defaults-settings"
import { YoutrustSettings } from "@/components/reunions/youtrust-settings"
type Association = {
  id:      string
  name:    string
  slug:    string
  city:    string | null
  country: string
  website: string | null
  iban:    string | null
  bic:     string | null
  plan:    "ESSENTIAL" | "PRO"
  customBrandingEnabled: boolean | null
  logoUrl: string | null
  cotisationDefaultAmount: string | number | null
}

type Tab = "general" | "paiements" | "abonnement" | "integrations"

function getAllTabs(t: ReturnType<typeof useTranslations>) {
  return [
    { value: "general"      as Tab, label: t("parametres.view.tabs.general"),      icon: <BuildingsIcon  className="size-3.5" />, modules: null            },
    { value: "paiements"    as Tab, label: t("parametres.view.tabs.paiements"),    icon: <CreditCardIcon className="size-3.5" />, modules: ["dons"]        },
    { value: "abonnement"   as Tab, label: t("parametres.view.tabs.abonnement"),   icon: <ReceiptIcon    className="size-3.5" />, modules: null            },
    { value: "integrations" as Tab, label: t("parametres.view.tabs.integrations"), icon: <LightningIcon  className="size-3.5" />, modules: ["ia", "sms", "reunions"]  },
  ] as const
}

const ADMINS  = ["ADMIN", "PRESIDENT"]
const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

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
  const t = useTranslations()
  const allTabs = getAllTabs(t)
  const { role } = useCurrentUser()
  const modules  = useModules()
  const canEdit  = ADMINS.includes(role)
  const canEditFinance = FINANCE.includes(role)
  const qc       = useQueryClient()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const fromUrl = searchParams.get("tab")
    return (allTabs.some(opt => opt.value === fromUrl) ? fromUrl : "general") as Tab
  })

  const tabs = allTabs.filter(opt => !opt.modules || opt.modules.some(m => modules[m]))

  useEffect(() => {
    if (!tabs.some(opt => opt.value === tab)) setTab("general")
  }, [tabs, tab])

  const { data: assoc, isLoading } = useQuery<Association>({
    queryKey: ["association"],
    queryFn:  async () => {
      const res = await fetch("/api/association")
      if (!res.ok) throw new Error(t("common.error"))
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
      if (!res.ok) throw new Error(await apiErrorMessage(res, t("common.error")))
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["association"] })
      qc.invalidateQueries({ queryKey: ["activity-logs"] })
      toast.success(t("parametres.view.toasts.saved"))
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  })

  return (
    <div className="space-y-6 py-4">
      <PageHeader
        title={t("parametres.view.title")}
        description={t("parametres.view.description")}
        action={<ViewToggle options={tabs} value={tab} onChange={setTab} />}
      />

      {/* ── Général ───────────────────────────────────────────────────── */}
      {tab === "general" && (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <h3 className="text-sm font-semibold mb-4">{t("parametres.view.associationInfo")}</h3>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2].map(i => <div key={i} className="h-10 rounded-lg bg-muted animate-pulse" />)}
              </div>
            ) : (
              <form onSubmit={handleSubmit(d => updateMutation.mutate(d))} className="space-y-4" noValidate>
                <FormField
                  label={t("parametres.view.associationName")}
                  required
                  disabled={!canEdit}
                  error={errors.name?.message}
                  {...register("name")}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    label={t("parametres.view.city")}
                    disabled={!canEdit}
                    placeholder={t("parametres.view.cityPlaceholder")}
                    error={errors.city?.message}
                    {...register("city")}
                  />
                  <FormField
                    label={t("parametres.view.country")}
                    required
                    disabled={!canEdit}
                    error={errors.country?.message}
                    {...register("country")}
                  />
                </div>
                {canEdit && (
                  <Button type="submit" size="sm" disabled={!isDirty} loading={isSubmitting || updateMutation.isPending}>
                    {t("common.save")}
                  </Button>
                )}
              </form>
            )}
          </div>

          {assoc && (
            <div className="rounded-lg border bg-card p-6">
              <BrandingSettings
                canEdit={canEdit}
                canUse={assoc.customBrandingEnabled ?? assoc.plan === "PRO"}
                data={{ logoUrl: assoc.logoUrl }}
              />
            </div>
          )}

          {assoc && (
            <div className="rounded-lg border bg-card p-6">
              <BankSettings
                canEdit={canEditFinance}
                data={{ website: assoc.website, iban: assoc.iban, bic: assoc.bic }}
              />
            </div>
          )}

          {assoc && modules.cotisations && (
            <div className="rounded-lg border bg-card p-6">
              <CotisationDefaultsSettings
                canEdit={canEditFinance}
                cotisationDefaultAmount={assoc.cotisationDefaultAmount}
              />
            </div>
          )}

          <MembreTypesManager canEdit={canEdit} />

          {assoc?.slug && (
            <div className="rounded-lg border bg-card p-6">
              <PortalLinkSettings slug={assoc.slug} />
            </div>
          )}
        </div>
      )}

      {/* ── Paiements ─────────────────────────────────────────────────── */}
      {tab === "paiements" && (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <StripeConnectSettings canEdit={canEdit} />
          </div>
          <div className="rounded-lg border bg-card p-6">
            <IdentityDonsSettings canEdit={canEdit} />
          </div>
        </div>
      )}

      {/* ── Abonnement ────────────────────────────────────────────────── */}
      {tab === "abonnement" && (
        <div className="space-y-6">
          <div className="rounded-lg border bg-card p-6">
            <BillingSettings canEdit={canEdit} />
          </div>
        </div>
      )}

      {/* ── Intégrations ──────────────────────────────────────────────── */}
      {tab === "integrations" && (
        <div className="space-y-6">
          {modules.ia && (
            <div className="rounded-lg border bg-card p-6">
              <AiSettings canEdit={canEdit} />
            </div>
          )}
          {modules.sms && (
            <div className="rounded-lg border bg-card p-6">
              <SmsSettings canEdit={canEdit} />
            </div>
          )}
          {modules.reunions && (
            <div className="rounded-lg border bg-card p-6">
              <LiveKitSettings canEdit={canEdit} />
            </div>
          )}
          {modules.reunions && (
            <div className="rounded-lg border bg-card p-6">
              <YoutrustSettings canEdit={canEdit} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
