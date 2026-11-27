"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { BuildingsIcon, CreditCardIcon, InfoIcon, LightningIcon, ReceiptIcon, ShieldCheckIcon, UsersThreeIcon } from "@phosphor-icons/react/dist/ssr";
import { associationSchema, type AssociationInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from "@/components/ui/accordion"
import { ViewToggle } from "@/components/ui/view-toggle"
import { FormField } from "@/components/ui/form-field"
import { Button } from "@/components/ui/button"
import { apiErrorMessage } from "@/lib/api-error"
import { useIsAdministrator, useModules } from "@/lib/user-context"
import { MembreTypesManager } from "@/components/parametres/membre-types-manager"
import { PortalLinkSettings } from "@/components/parametres/portal-link-settings"
import { CustomDomainSettings } from "@/components/parametres/custom-domain-settings"
import { AiSettings } from "@/components/ai/ai-settings"
import { SmsSettings } from "@/components/sms/sms-settings"
import { LiveKitSettings } from "@/components/reunions/livekit-settings"
import { StripeConnectSettings } from "@/components/parametres/stripe-connect-settings"
import { IdentityDonsSettings } from "@/components/parametres/identity-dons-settings"
import { ShippingSettings } from "@/components/parametres/shipping-settings"
import { BillingSettings } from "@/components/parametres/billing-settings"
import { BrandingSettings } from "@/components/parametres/branding-settings"
import { MemberCardSettings } from "@/components/parametres/member-card-settings"
import { BankSettings } from "@/components/parametres/bank-settings"
import { CotisationDefaultsSettings } from "@/components/parametres/cotisation-defaults-settings"
import { TeamAccessSettings } from "@/components/parametres/team-access-settings"
import { ErasureRequestsSettings } from "@/components/parametres/erasure-requests-settings"
import type { AssociationPlan } from "@prisma/client"
type Association = {
  id:      string
  name:    string
  slug:    string
  city:    string | null
  country: string
  phone:   string | null
  contactEmail: string | null
  website: string | null
  iban:    string | null
  bic:     string | null
  accountingRegime: "ACCRUAL" | "CASH"
  plan:    AssociationPlan
  customBrandingEnabled: boolean | null
  logoUrl: string | null
  primaryColor: string | null
  emailSenderName: string | null
  emailSignature: string | null
  emailFooterSettings: unknown
  cotisationDefaultAmount: string | number | null
  publicMembershipPaymentEnabled: boolean
  includeFederativeLicenseInAutoRenewal: boolean
}

type Tab = "general" | "paiements" | "abonnement" | "integrations" | "equipe" | "rgpd"

function getAllTabs(t: ReturnType<typeof useTranslations>) {
  return [
    { value: "general"      as Tab, label: t("parametres.view.tabs.general"),      icon: <BuildingsIcon   className="size-3.5" />, modules: null,           administratorOnly: false },
    { value: "paiements"    as Tab, label: t("parametres.view.tabs.paiements"),    icon: <CreditCardIcon className="size-3.5" />, modules: ["dons"],       administratorOnly: false },
    { value: "abonnement"   as Tab, label: t("parametres.view.tabs.abonnement"),   icon: <ReceiptIcon     className="size-3.5" />, modules: null,           administratorOnly: false },
    { value: "integrations" as Tab, label: t("parametres.view.tabs.integrations"), icon: <LightningIcon        className="size-3.5" />, modules: ["ia", "sms"], administratorOnly: false },
    { value: "equipe"       as Tab, label: t("parametres.view.tabs.equipe"),       icon: <UsersThreeIcon  className="size-3.5" />, modules: null,           administratorOnly: true  },
    { value: "rgpd"         as Tab, label: t("parametres.view.tabs.rgpd"),         icon: <ShieldCheckIcon className="size-3.5" />, modules: null,           administratorOnly: true  },
  ] as const
}


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
  const modules  = useModules()
  // The page is administrators-only (see src/lib/dashboard-access.ts), so every section is
  // editable by whoever reaches it.
  const isAdministrator = useIsAdministrator()
  const canEdit         = isAdministrator
  const canEditFinance  = isAdministrator
  const qc       = useQueryClient()
  const searchParams = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => {
    const fromUrl = searchParams.get("tab")
    return (allTabs.some(opt => opt.value === fromUrl) ? fromUrl : "general") as Tab
  })

  const tabs = allTabs.filter(opt =>
    (!opt.modules || opt.modules.some(m => modules[m])) && (!opt.administratorOnly || isAdministrator),
  )

  // "Général" groups several unrelated topics (identité, branding, carte de membre, coordonnées
  // bancaires, cotisation par défaut, types de membre, livraison, domaine) — an Accordion keeps
  // them reachable without stacking that many cards in one long scroll. Only the first section
  // opens by default; the others are one click away.
  const [openGeneralSections, setOpenGeneralSections] = useState<string[]>(["info"])

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

  const { register, handleSubmit, reset, control, formState: { errors, isDirty, isSubmitting } } = useForm<AssociationInput>({
    resolver:      zodResolver(associationSchema),
    defaultValues: { name: "", city: "", country: "France", contactEmail: "" },
  })
  const contactEmailValue = useWatch({ control, name: "contactEmail" })

  useEffect(() => {
    if (assoc) reset({ name: assoc.name, city: assoc.city ?? "", country: assoc.country, contactEmail: assoc.contactEmail ?? "" })
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
        <Accordion
          multiple
          keepMounted
          value={openGeneralSections}
          onValueChange={v => setOpenGeneralSections(v as string[])}
        >
          <AccordionItem value="info">
            <AccordionTrigger>{t("parametres.view.associationInfo")}</AccordionTrigger>
            <AccordionPanel>
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
                  <FormField
                    label={t("parametres.view.contactEmail")}
                    placeholder={t("parametres.view.contactEmailPlaceholder")}
                    hint={t("parametres.view.contactEmailHint")}
                    type="email"
                    disabled={!canEdit}
                    error={errors.contactEmail?.message}
                    {...register("contactEmail")}
                  />
                  {!contactEmailValue?.trim() && (
                    <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                      <InfoIcon className="size-3.5 shrink-0 mt-0.5" />
                      <span>{t("parametres.view.contactEmailEmptyWarning")}</span>
                    </div>
                  )}
                  {canEdit && (
                    <Button type="submit" size="sm" disabled={!isDirty} loading={isSubmitting || updateMutation.isPending}>
                      {t("common.save")}
                    </Button>
                  )}
                </form>
              )}
            </AccordionPanel>
          </AccordionItem>

          {assoc && (
            <AccordionItem value="branding">
              <AccordionTrigger>{t("parametres.branding.title")}</AccordionTrigger>
              <AccordionPanel>
                <BrandingSettings
                  canEdit={canEdit}
                  canUse={assoc.customBrandingEnabled ?? assoc.plan === "PRO"}
                  hideTitle
                  data={{
                    logoUrl:         assoc.logoUrl,
                    primaryColor:    assoc.primaryColor,
                    emailSenderName:     assoc.emailSenderName,
                    emailSignature:      assoc.emailSignature,
                    emailFooterSettings: assoc.emailFooterSettings,
                    associationName:     assoc.name,
                  }}
                />
              </AccordionPanel>
            </AccordionItem>
          )}

          {/* The card itself is not Pro-gated — only its logo is, exactly like the PDFs
              (resolveDocumentBranding): without custom branding the card simply shows none.
              Rendered only for the roles that may edit it, unlike the blocks around it: its
              GET is ADMIN/PRESIDENT-only (see api/association/member-card), so a Trésorier or
              a Secrétaire would be shown the *defaults* — card off, Classique, bleu — as if
              they were the association's real settings. */}
          {assoc && modules.cotisations && canEdit && (
            <AccordionItem value="memberCard">
              <AccordionTrigger>{t("memberCard.settings.title")}</AccordionTrigger>
              <AccordionPanel>
                <MemberCardSettings
                  canEdit={canEdit}
                  hideTitle
                  associationName={assoc.name}
                  logoUrl={(assoc.customBrandingEnabled ?? assoc.plan === "PRO") ? assoc.logoUrl : null}
                  associationPhone={assoc.phone}
                  associationContactEmail={assoc.contactEmail}
                />
              </AccordionPanel>
            </AccordionItem>
          )}

          {assoc && (
            <AccordionItem value="bank">
              <AccordionTrigger>{t("parametres.bankSettings.title")}</AccordionTrigger>
              <AccordionPanel>
                <BankSettings
                  canEdit={canEditFinance}
                  hideTitle
                  data={{ website: assoc.website, iban: assoc.iban, bic: assoc.bic, accountingRegime: assoc.accountingRegime }}
                />
              </AccordionPanel>
            </AccordionItem>
          )}

          {assoc && modules.cotisations && (
            <AccordionItem value="cotisationDefaults">
              <AccordionTrigger>{t("parametres.cotisationDefaultsSettings.title")}</AccordionTrigger>
              <AccordionPanel>
                <CotisationDefaultsSettings
                  canEdit={canEditFinance}
                  hideTitle
                  cotisationDefaultAmount={assoc.cotisationDefaultAmount}
                  publicMembershipPaymentEnabled={assoc.publicMembershipPaymentEnabled}
                  includeFederativeLicenseInAutoRenewal={assoc.includeFederativeLicenseInAutoRenewal}
                />
              </AccordionPanel>
            </AccordionItem>
          )}

          <AccordionItem value="membreTypes">
            <AccordionTrigger>{t("parametres.membreTypes.title")}</AccordionTrigger>
            <AccordionPanel>
              <MembreTypesManager canEdit={canEdit} hideTitle />
            </AccordionPanel>
          </AccordionItem>

          {modules.boutique && (
            <AccordionItem value="shipping">
              <AccordionTrigger>{t("boutiqueShipping.title")}</AccordionTrigger>
              <AccordionPanel>
                <ShippingSettings canEdit={canEdit} hideTitle />
              </AccordionPanel>
            </AccordionItem>
          )}

          {assoc?.slug && (
            <AccordionItem value="portalLink">
              <AccordionTrigger>{t("parametres.portalLinkSettings.title")}</AccordionTrigger>
              <AccordionPanel>
                <PortalLinkSettings slug={assoc.slug} hideTitle />
              </AccordionPanel>
            </AccordionItem>
          )}

          <AccordionItem value="customDomain">
            <AccordionTrigger>{t("parametres.customDomainSettings.title")}</AccordionTrigger>
            <AccordionPanel>
              <CustomDomainSettings canEdit={canEdit} hideTitle />
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
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

      {/* ── Équipe et accès (administrators only) ─────────────────────── */}
      {tab === "equipe" && isAdministrator && (
        <div className="rounded-lg border bg-card p-6">
          <TeamAccessSettings />
        </div>
      )}

      {/* ── RGPD (administrators only) ─────────────────────────────────── */}
      {tab === "rgpd" && isAdministrator && (
        <div className="rounded-lg border bg-card p-6">
          <ErasureRequestsSettings />
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
        </div>
      )}
    </div>
  )
}
