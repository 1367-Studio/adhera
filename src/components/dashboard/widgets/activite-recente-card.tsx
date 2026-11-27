"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { RecentOrdersCard } from "@/components/dashboard/widgets/recent-orders-card"
import { RecentDonationsCard } from "@/components/dashboard/widgets/recent-donations-card"

type Vente = {
  id:          string
  totalAmount: number
  date:        string
  guestName:   string | null
  membre:      { firstName: string; lastName: string } | null
  status:      "PENDING" | "PAID"
}

type Don = {
  id:          string
  amount:      number
  date:        string
  donorType:   "INDIVIDUAL" | "COMPANY"
  firstName:   string
  lastName:    string
  companyName: string | null
  anonymous:   boolean
  status:      "PENDING" | "PAID"
}

interface Props {
  ventesRecentes: Vente[]
  donsRecents:    Don[]
  isLoading: boolean
}

// Merges recent-orders and dons-recents into one tabbed widget (FORM-120) — "Commandes" /
// "Dons" — instead of two cards sitting side by side. Both tabs reuse the existing row
// rendering from RecentOrdersCard/RecentDonationsCard (now content-only, no own wrapper).
export function ActiviteRecenteCard({ ventesRecentes, donsRecents, isLoading }: Props) {
  const t = useTranslations("dashboard.activiteRecente")
  // Defaults to "Dons" (FORM-129), even for associations with boutique enabled.
  const [tab, setTab] = useState<"commandes" | "dons">("dons")

  return (
    <div className="rounded-lg bg-muted/60 p-6 space-y-3 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center gap-2">
        <ClockCounterClockwiseIcon className="size-4.5 text-muted-foreground" />
        <span className="text-base font-medium">{t("title")}</span>
      </div>
      <Tabs value={tab} onValueChange={v => setTab(v as "commandes" | "dons")} className="flex min-h-0 flex-1 flex-col gap-3">
        <TabsList>
          <TabsTrigger value="commandes">{t("tabs.commandes")}</TabsTrigger>
          <TabsTrigger value="dons">{t("tabs.dons")}</TabsTrigger>
        </TabsList>
        <TabsContent value="commandes" className="min-h-0 flex-1">
          <RecentOrdersCard ventesRecentes={ventesRecentes} isLoading={isLoading} />
        </TabsContent>
        <TabsContent value="dons" className="min-h-0 flex-1">
          <RecentDonationsCard donsRecents={donsRecents} isLoading={isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
