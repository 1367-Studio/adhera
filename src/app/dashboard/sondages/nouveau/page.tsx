"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { ArrowLeftIcon, MagnifyingGlassIcon, UsersIcon, CheckIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SondageFormBuilder } from "@/components/sondages/sondage-form-builder"
import type { BuilderQuestion } from "@/components/sondages/sondage-form-builder"

type Membre = { id: string; firstName: string; lastName: string; email: string | null }

export default function NouveauSondagePage() {
  const t = useTranslations()
  const router = useRouter()

  const [title, setTitle]               = useState("")
  const [description, setDescription]   = useState("")
  const [anonymous, setAnonymous]        = useState(false)
  const [deadline, setDeadline]          = useState("")
  const [recipientMode, setRecipientMode] = useState<"ALL" | "SELECTED">("ALL")
  const [recipientIds, setRecipientIds]  = useState<string[]>([])
  const [memberSearch, setMemberSearch]  = useState("")
  const [questions, setQuestions]        = useState<BuilderQuestion[]>([])

  const { data: membres = [] } = useQuery<Membre[]>({
    queryKey: ["membres", "all"],
    queryFn:  async () => {
      const res = await fetch("/api/membres")
      if (!res.ok) return []
      return res.json()
    },
    enabled: recipientMode === "SELECTED",
  })

  const filteredMembres = membres.filter(m => {
    if (!memberSearch) return true
    const q = memberSearch.toLowerCase()
    return (
      m.firstName.toLowerCase().includes(q) ||
      m.lastName.toLowerCase().includes(q)  ||
      (m.email ?? "").toLowerCase().includes(q)
    )
  })

  function toggleMembre(id: string) {
    setRecipientIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    )
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/sondages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description:  description || null,
          anonymous,
          deadline:     deadline ? `${deadline}T23:59:59.000Z` : null,
          recipientMode,
          recipientIds: recipientMode === "SELECTED" ? recipientIds : undefined,
          questions:    questions.map(q => ({
            clientKey: q._key,
            type:      q.type,
            label:     q.label,
            required:  q.required,
            order:     q.order,
            options:   q.options,
            condition: q.condition,
          })),
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? t("sondages.newSurveyPage.toasts.createError"))
      }
      return res.json()
    },
    onSuccess: (data) => {
      toast.success(t("sondages.newSurveyPage.toasts.created"))
      router.push(`/dashboard/sondages/${data.id}`)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("common.error")),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error(t("sondages.newSurveyPage.toasts.titleRequired")); return }
    if (questions.length === 0) { toast.error(t("sondages.newSurveyPage.toasts.atLeastOneQuestion")); return }
    if (recipientMode === "SELECTED" && recipientIds.length === 0) {
      toast.error(t("sondages.newSurveyPage.toasts.atLeastOneMember"))
      return
    }
    mutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button type="button" variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold">{t("sondages.newSurveyPage.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("sondages.newSurveyPage.subtitle")}</p>
        </div>
      </div>

      {/* Unified card */}
      <div className="rounded-xl border bg-card overflow-hidden pb-10">
        <div className="grid grid-cols-1 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x">

          {/* Left — metadata */}
          <div className="lg:col-span-2 p-5 space-y-4">
            <h2 className="text-sm font-semibold">{t("sondages.newSurveyPage.generalInfo")}</h2>

            <div className="space-y-1.5">
              <Label htmlFor="title">{t("sondages.newSurveyPage.titleLabel")} <span className="ml-0.5 text-destructive" aria-hidden>*</span></Label>
              <Input
                id="title"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={t("sondages.newSurveyPage.titlePlaceholder")}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="desc">{t("sondages.newSurveyPage.descriptionLabel")} <span className="text-muted-foreground font-normal">{t("sondages.newSurveyPage.optional")}</span></Label>
              <textarea
                id="desc"
                rows={3}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t("sondages.newSurveyPage.descriptionPlaceholder")}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="deadline">{t("sondages.newSurveyPage.deadlineLabel")} <span className="text-muted-foreground font-normal">{t("sondages.newSurveyPage.optional")}</span></Label>
              <Input
                id="deadline"
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>{t("actualites.form.recipients")}</Label>
              <div className="inline-flex rounded-lg border bg-muted/30 p-0.5 gap-0.5 w-full">
                {(["ALL", "SELECTED"] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setRecipientMode(mode)
                      if (mode === "ALL") setRecipientIds([])
                    }}
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                      recipientMode === mode
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {mode === "ALL" ? t("actualites.form.recipientsAll") : t("sondages.newSurveyPage.recipientsManual")}
                  </button>
                ))}
              </div>
            </div>

            {/* Member picker (only when SELECTED) */}
            {recipientMode === "SELECTED" && (
              <div className="rounded-lg border bg-muted/10 overflow-hidden">
                <div className="relative border-b">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder={t("actualites.form.searchMemberPlaceholder")}
                    value={memberSearch}
                    onChange={e => setMemberSearch(e.target.value)}
                    className="w-full bg-transparent pl-8 pr-3 py-2 text-sm outline-none"
                  />
                </div>

                <div className="max-h-48 overflow-y-auto divide-y">
                  {filteredMembres.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
                      <UsersIcon className="size-4" />
                      {membres.length === 0 ? t("actualites.form.loading") : t("actualites.form.noResult")}
                    </div>
                  ) : (
                    filteredMembres.map(m => {
                      const checked = recipientIds.includes(m.id)
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleMembre(m.id)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
                            checked && "bg-primary/5",
                          )}
                        >
                          <div className={cn(
                            "size-4 rounded shrink-0 border flex items-center justify-center transition-colors",
                            checked ? "bg-primary border-primary" : "border-input",
                          )}>
                            {checked && <CheckIcon className="size-2.5 text-primary-foreground" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{m.firstName} {m.lastName}</p>
                            {m.email && <p className="text-xs text-muted-foreground truncate">{m.email}</p>}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>

                {recipientIds.length > 0 && (
                  <div className="border-t px-3 py-2 bg-muted/20 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {t("actualites.form.selectedCount", { count: recipientIds.length })}
                    </span>
                    <button
                      type="button"
                      onClick={() => setRecipientIds([])}
                      className="text-xs text-muted-foreground hover:text-foreground underline"
                    >
                      {t("actualites.form.deselectAll")}
                    </button>
                  </div>
                )}
              </div>
            )}

            <label className="flex items-center gap-2.5 cursor-pointer select-none text-sm">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={e => setAnonymous(e.target.checked)}
                className="rounded accent-foreground"
              />
              <span>{t("sondages.newSurveyPage.anonymousLabel")} <span className="text-muted-foreground">{t("sondages.newSurveyPage.anonymousHint")}</span></span>
            </label>
          </div>

          {/* Right — questions */}
          <div className="lg:col-span-3 p-5 space-y-3">
            <h2 className="text-sm font-semibold">{t("sondages.newSurveyPage.questionsLabel")} <span className="ml-0.5 text-destructive" aria-hidden>*</span></h2>
            <SondageFormBuilder onChange={setQuestions} />
          </div>
        </div>

        <div className="border-t px-5 py-3 bg-muted/20 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {t("sondages.newSurveyPage.createButton")}
          </Button>
        </div>
      </div>
    </form>
  )
}
