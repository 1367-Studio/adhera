"use client"

import { useState } from "react"
import { LayoutTemplateIcon, ZapIcon, ClockIcon, ListChecksIcon } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { ViewToggle } from "@/components/ui/view-toggle"
import { Button } from "@/components/ui/button"
import { TemplatesManager } from "@/components/messages/templates-manager"
import { RulesManager } from "@/components/messages/rules-manager"
import { HistoriqueView } from "@/components/messages/historique-view"
import { CampagneModal } from "@/components/messages/campagne-modal"

type View = "templates" | "rules" | "historique"

const OPTIONS = [
  { value: "templates"  as View, label: "Modèles",        icon: <LayoutTemplateIcon className="size-3.5" /> },
  { value: "rules"      as View, label: "Automatisations", icon: <ZapIcon            className="size-3.5" /> },
  { value: "historique" as View, label: "Historique",      icon: <ClockIcon          className="size-3.5" /> },
]

export function MessagesView() {
  const [view,          setView]          = useState<View>("templates")
  const [campagneOpen,  setCampagneOpen]  = useState(false)

  return (
    <div className="space-y-6 py-4">
      <PageHeader
        title="Messages"
        description="Modèles de messages et envois automatiques"
        action={
          <div className="flex items-center gap-2">
            {view === "rules" && (
              <Button variant="outline" size="sm" onClick={() => setCampagneOpen(true)}>
                <ListChecksIcon className="mr-1.5 size-3.5" /> Régua de rappels
              </Button>
            )}
            <ViewToggle options={OPTIONS} value={view} onChange={setView} />
          </div>
        }
      />

      {view === "templates"  && <TemplatesManager />}
      {view === "rules"      && <RulesManager />}
      {view === "historique" && <HistoriqueView />}

      <CampagneModal open={campagneOpen} onOpenChange={setCampagneOpen} />
    </div>
  )
}
