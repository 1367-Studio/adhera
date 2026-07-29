"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { LayoutIcon, LightningIcon, ClockIcon, ListChecksIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui/page-header"
import { ViewToggle } from "@/components/ui/view-toggle"
import { Button } from "@/components/ui/button"
import { TemplatesManager } from "@/components/messages/templates-manager"
import { RulesManager } from "@/components/messages/rules-manager"
import { HistoriqueView } from "@/components/messages/historique-view"
import { CampagneModal } from "@/components/messages/campagne-modal"

type View = "templates" | "rules" | "historique"

export function MessagesView() {
  const t = useTranslations("messages.view")
  const [view,          setView]          = useState<View>("templates")
  const [campagneOpen,  setCampagneOpen]  = useState(false)

  const options = [
    { value: "templates"  as View, label: t("tabs.templates"),  icon: <LayoutIcon className="size-3.5" /> },
    { value: "rules"      as View, label: t("tabs.rules"),      icon: <LightningIcon className="size-3.5" /> },
    { value: "historique" as View, label: t("tabs.historique"), icon: <ClockIcon className="size-3.5" /> },
  ]

  return (
    <div className="space-y-6 py-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        action={
          <div className="flex items-center gap-2">
            {view === "rules" && (
              <Button variant="outline" size="sm" onClick={() => setCampagneOpen(true)}>
                <ListChecksIcon className="mr-1.5 size-3.5" /> {t("reminderSchedule")}
              </Button>
            )}
            <ViewToggle options={options} value={view} onChange={setView} />
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
