"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { EmptyState } from "@/components/ui/empty-state"
import { useExercices } from "@/hooks/use-exercices"
import { useChartAccounts, useCreateManualJournalEntry, type ManualJournalEntryInput } from "@/hooks/use-journal-manual"
import { ManualJournalEntryForm } from "@/components/finances/manual-journal-entry-form"

export function JournalManualView() {
  const t = useTranslations("finances.journalManual")
  const [createOpen, setCreateOpen] = useState(false)

  const { data: exercices = [] } = useExercices()
  const { data: chartAccounts = [] } = useChartAccounts()
  const createMutation = useCreateManualJournalEntry()

  // Lancer une écriture dans un exercice clôturé n'a pas de sens (voir la validation côté
  // serveur) — ne les propose même pas au sélecteur.
  const openExercices = exercices.filter((e: { status: string }) => e.status === "OUVERT")
  const exerciceOptions = openExercices.map((e: { id: string; label: string }) => ({ value: e.id, label: e.label }))

  async function handleCreate(data: ManualJournalEntryInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success(t("createSuccess"))
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("submit"))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("description")}
        action={
          exerciceOptions.length > 0 && (
            <Button onClick={() => setCreateOpen(true)}>
              <PlusIcon className="mr-1.5 size-4" />
              {t("newEntry")}
            </Button>
          )
        }
      />

      {exerciceOptions.length === 0 && <EmptyState title={t("noOpenExercice")} />}

      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t("newEntry")} size="2xl">
        <ManualJournalEntryForm
          exerciceOptions={exerciceOptions}
          chartAccounts={chartAccounts}
          onSubmit={handleCreate}
          onCancel={() => setCreateOpen(false)}
          loading={createMutation.isPending}
        />
      </Modal>
    </div>
  )
}
