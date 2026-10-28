"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { CopySimpleIcon } from "@phosphor-icons/react/dist/ssr"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useExercices } from "@/hooks/use-exercices"
import { PrevisionnelGlobalTab } from "@/components/finances/previsionnel-global-tab"
import { PrevisionnelProjectTab } from "@/components/finances/previsionnel-project-tab"
import { CopyPreviousBudgetModal } from "@/components/finances/copy-previous-budget-modal"

// Exercice selector shared by both tabs — lives here (not inside either tab) so switching
// tabs keeps the same exercice selected, per the spec's "Exercice comptable" requirement.
export function PrevisionnelView() {
  const t = useTranslations("finances.previsionnel")
  const [exerciceId, setExerciceId] = useState("")
  const [copyOpen, setCopyOpen] = useState(false)

  const { data: exercices = [], isLoading } = useExercices()
  const noExercice = !isLoading && exercices.length === 0

  const selectedExerciceId = exerciceId || exercices[exercices.length - 1]?.id || ""
  const selectedExercice   = exercices.find(e => e.id === selectedExerciceId)

  // Exercices come back sorted by startDate ascending (same convention as
  // /api/finances/budget) — the previous exercice is simply the one right before the
  // selected one in that order, same logic as findPreviousExercice (server-only, not
  // importable here since it lives in a module that pulls in prisma).
  const selectedIndex     = exercices.findIndex(e => e.id === selectedExerciceId)
  const previousExercice  = selectedIndex > 0 ? exercices[selectedIndex - 1] : null

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        action={!noExercice && (
          <div className="flex items-center gap-2">
            <Select value={selectedExerciceId} onValueChange={(v) => setExerciceId(v ?? selectedExerciceId)}>
              <SelectTrigger className="w-44">
                <SelectValue>{selectedExercice?.label ?? t("exerciceLabel")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {exercices.map(e => <SelectItem key={e.id} value={e.id}>{e.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={!previousExercice} onClick={() => setCopyOpen(true)}>
              <CopySimpleIcon className="mr-1.5 size-4" />
              {t("copyBudget.action")}
            </Button>
          </div>
        )}
      />

      {noExercice ? (
        <EmptyState title={t("emptyExercice.title")} description={t("emptyExercice.description")} />
      ) : (
        <Tabs defaultValue="global">
          <TabsList>
            <TabsTrigger value="global">{t("tabs.global")}</TabsTrigger>
            <TabsTrigger value="projects">{t("tabs.projects")}</TabsTrigger>
          </TabsList>
          <TabsContent value="global">
            <PrevisionnelGlobalTab exerciceId={selectedExerciceId} />
          </TabsContent>
          <TabsContent value="projects">
            <PrevisionnelProjectTab exerciceId={selectedExerciceId} />
          </TabsContent>
        </Tabs>
      )}

      {previousExercice && selectedExercice && (
        <CopyPreviousBudgetModal
          open={copyOpen}
          onOpenChange={setCopyOpen}
          targetExerciceId={selectedExerciceId}
          targetExerciceLabel={selectedExercice.label}
          previousExerciceLabel={previousExercice.label}
        />
      )}
    </div>
  )
}
