"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { LayoutIcon, LightningIcon, ClockIcon, ListChecksIcon, CaretDownIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/ssr";
import { PageHeader } from "@/components/ui/page-header"
import { ViewToggle } from "@/components/ui/view-toggle"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { TemplatesManager } from "@/components/messages/templates-manager"
import { RulesManager } from "@/components/messages/rules-manager"
import { HistoriqueView } from "@/components/messages/historique-view"
import { CampagneModal } from "@/components/messages/campagne-modal"
import { SendEmailModal } from "@/components/membres/send-email-modal"
import { SendSmsModal } from "@/components/membres/send-sms-modal"
import { useModules } from "@/lib/user-context"

type View = "templates" | "rules" | "historique"

export function MessagesView() {
  const t = useTranslations("messages.view")
  const tMembres = useTranslations("membres.view")
  const modules = useModules()
  const [view,          setView]          = useState<View>("templates")
  const [campagneOpen,  setCampagneOpen]  = useState(false)
  const [emailOpen,     setEmailOpen]     = useState(false)
  const [smsOpen,       setSmsOpen]       = useState(false)

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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="outline" aria-label={tMembres("communication")} />}>
                <PaperPlaneTiltIcon className="size-4 sm:hidden" />
                <span className="hidden sm:inline">{tMembres("communication")}</span>
                <CaretDownIcon className="ml-1 size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEmailOpen(true)}>
                  {tMembres("sendEmail")}
                </DropdownMenuItem>
                {modules.sms && (
                  <DropdownMenuItem onClick={() => setSmsOpen(true)}>
                    {tMembres("sendSms")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {view === "rules" && (
              <Button variant="outline" size="sm" aria-label={t("reminderSchedule")} onClick={() => setCampagneOpen(true)}>
                <ListChecksIcon className="size-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">{t("reminderSchedule")}</span>
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
      <SendEmailModal open={emailOpen} onOpenChange={setEmailOpen} />
      <SendSmsModal open={smsOpen} onOpenChange={setSmsOpen} />
    </div>
  )
}
