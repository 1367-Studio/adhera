"use client"

import { useTranslations } from "next-intl"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { SupportTicketsView } from "@/components/support/support-tickets-view"
import { SupportInformationalMessages } from "@/components/support/support-informational-messages"

export function SupportPageTabs() {
  const t = useTranslations("support")

  return (
    <Tabs defaultValue="chat" className="mt-4">
      <TabsList>
        <TabsTrigger value="chat">{t("tabs.chat")}</TabsTrigger>
        <TabsTrigger value="informational">{t("tabs.informational")}</TabsTrigger>
      </TabsList>

      <TabsContent value="chat">
        <SupportTicketsView />
      </TabsContent>

      <TabsContent value="informational" className="pt-3">
        <SupportInformationalMessages />
      </TabsContent>
    </Tabs>
  )
}
