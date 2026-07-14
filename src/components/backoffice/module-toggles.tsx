"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import type { AssocModules } from "@/lib/modules"
import { MODULE_LABELS } from "@/lib/modules"
import { Button } from "@/components/ui/button"
import { WarningIcon, CalendarBlankIcon, CreditCardIcon, NewspaperIcon, BellIcon, PackageIcon, GlobeIcon, SparkleIcon, HeartIcon, ChartBarIcon, ShoppingBagIcon, VideoCameraIcon, ChatTextIcon, MoneyIcon, BuildingsIcon, FileTextIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import type { Icon as LucideIcon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils"

const MODULE_META: Record<keyof AssocModules, { icon: LucideIcon; description: string }> = {
  evenements:  { icon: CalendarBlankIcon,    description: "Agenda, inscriptions et billetterie" },
  cotisations: { icon: CreditCardIcon,  description: "Suivi des adhésions et paiements" },
  actualites:  { icon: NewspaperIcon,   description: "Articles et communications membres" },
  messages:    { icon: BellIcon,        description: "Emails automatiques et notifications" },
  materiel:    { icon: PackageIcon,     description: "Inventaire et prêt de matériel" },
  site:        { icon: GlobeIcon,       description: "Page publique de l'association" },
  ia:          { icon: SparkleIcon,    description: "Rédaction assistée par IA" },
  dons:        { icon: HeartIcon,       description: "Collecte de dons en ligne" },
  sondages:    { icon: ChartBarIcon,   description: "Création et diffusion de sondages" },
  boutique:    { icon: ShoppingBagIcon, description: "Vente de produits aux membres" },
  reunions:    { icon: VideoCameraIcon,             description: "Réunions et assemblées générales" },
  sms:         { icon: ChatTextIcon, description: "Notifications SMS via Twilio" },
  finances:    { icon: MoneyIcon,          description: "Conciliation bancaire et comptabilité" },
  fournisseurs: { icon: BuildingsIcon,     description: "Répertoire des fournisseurs" },
  devis:        { icon: FileTextIcon,      description: "Devis et suivi des propositions" },
  factures:     { icon: ReceiptIcon,       description: "Facturation et suivi des paiements" },
}

interface Props {
  associationId:  string
  initialModules: AssocModules
}

export function ModuleToggles({ associationId, initialModules }: Props) {
  const [saved,   setSaved]   = useState<AssocModules>(initialModules)
  const [modules, setModules] = useState<AssocModules>(initialModules)
  const [pending, startTransition] = useTransition()
  const isDirty = JSON.stringify(modules) !== JSON.stringify(saved)

  function toggle(key: keyof AssocModules) {
    setModules(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function save() {
    startTransition(async () => {
      const snapshot = modules
      const res = await fetch(`/api/backoffice/associations/${associationId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ modules: snapshot }),
      })
      if (res.ok) {
        setSaved(snapshot)
        toast.success("Modules mis à jour")
      } else {
        setModules(saved)
        toast.error("Erreur lors de la sauvegarde")
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {(Object.keys(MODULE_META) as (keyof AssocModules)[]).map(key => {
          const { icon: Icon, description } = MODULE_META[key]
          const enabled = modules[key]
          return (
            <button
              key={key}
              type="button"
              onClick={() => !pending && toggle(key)}
              disabled={pending}
              className={cn(
                "group relative flex flex-col gap-3 rounded-xl border p-4 text-left transition-all",
                enabled
                  ? "border-foreground/20 bg-foreground/[0.04]"
                  : "border-border bg-background hover:bg-muted/40",
                pending && "cursor-not-allowed opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                  enabled ? "bg-foreground text-background" : "bg-muted text-muted-foreground",
                )}>
                  <Icon className="size-4" />
                </div>
                <div className={cn(
                  "relative mt-0.5 inline-flex h-4 w-7 shrink-0 rounded-full border-2 border-transparent transition-colors",
                  enabled ? "bg-primary" : "bg-input",
                )}>
                  <span className={cn(
                    "pointer-events-none inline-block size-3 rounded-full bg-white shadow-sm transition-transform",
                    enabled ? "translate-x-3" : "translate-x-0",
                  )} />
                </div>
              </div>

              <div>
                <p className={cn(
                  "text-xs font-semibold leading-tight",
                  enabled ? "text-foreground" : "text-muted-foreground",
                )}>
                  {MODULE_LABELS[key]}
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {description}
                </p>
              </div>

              {key === "site" && !enabled && saved[key] && (
                <p className="flex items-center gap-1 text-[11px] text-amber-600">
                  <WarningIcon className="size-3 shrink-0" />
                  Retirera le site public immédiatement.
                </p>
              )}
            </button>
          )
        })}
      </div>

      {isDirty && (
        <Button size="sm" onClick={save} loading={pending} disabled={pending}>
          Sauvegarder
        </Button>
      )}
    </div>
  )
}
