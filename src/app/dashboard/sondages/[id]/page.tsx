"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { ArrowLeftIcon, CheckCircleIcon, LockIcon, BarChart2Icon, PencilIcon, RefreshCwIcon, ClipboardListIcon, SearchIcon, UsersIcon, CheckIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { SondageFormBuilder } from "@/components/sondages/sondage-form-builder"
import { SondageResultats } from "@/components/sondages/sondage-resultats"
import type { BuilderQuestion } from "@/components/sondages/sondage-form-builder"

type Membre = { id: string; firstName: string; lastName: string; email: string | null }

type Sondage = {
  id:           string
  title:        string
  description:  string | null
  status:       "BROUILLON" | "ACTIF" | "FERME"
  recipientMode: "ALL" | "SELECTED"
  anonymous:    boolean
  deadline:     string | null
  questions:    {
    id:        string
    type:      string
    label:     string
    required:  boolean
    order:     number
    options:   string[] | null
    condition: { questionId: string; operator: string; value: string } | null
  }[]
  recipients:   { membreId: string }[]
  _count:       { reponses: number }
}

const STATUS_LABEL = { BROUILLON: "Brouillon", ACTIF: "Actif", FERME: "Fermé" }
const STATUS_VARIANT: Record<string, "secondary" | "default" | "outline"> = {
  BROUILLON: "secondary", ACTIF: "default", FERME: "outline",
}

function toBuilderQuestions(qs: Sondage["questions"]): BuilderQuestion[] {
  return qs.map(q => ({
    _key:      q.id,
    id:        q.id,
    type:      q.type as BuilderQuestion["type"],
    label:     q.label,
    required:  q.required,
    order:     q.order,
    options:   q.options,
    condition: q.condition as BuilderQuestion["condition"],
  }))
}

export default function SondageDetailPage() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()
  const qc      = useQueryClient()

  const [activeTab, setActiveTab] = useState("edit")

  const { data: sondage, isLoading } = useQuery<Sondage>({
    queryKey:  ["sondage", id],
    queryFn:   () => fetch(`/api/sondages/${id}`).then(r => r.json()),
    staleTime: 0,
  })

  const { data: resultats, isLoading: resultatsLoading, refetch: refetchResultats } = useQuery({
    queryKey:  ["sondage-resultats", id],
    queryFn:   () => fetch(`/api/sondages/${id}/resultats`).then(r => r.json()),
    enabled:   activeTab === "resultats",
    staleTime: 0,
  })

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

  function toggleMembre(membreId: string) {
    setRecipientIds(prev =>
      prev.includes(membreId) ? prev.filter(x => x !== membreId) : [...prev, membreId],
    )
  }

  useEffect(() => {
    if (!sondage) return
    setTitle(sondage.title)
    setDescription(sondage.description ?? "")
    setAnonymous(sondage.anonymous)
    setDeadline(sondage.deadline ? sondage.deadline.slice(0, 10) : "")
    setRecipientMode(sondage.recipientMode)
    setRecipientIds(sondage.recipients.map(r => r.membreId))
    setQuestions(toBuilderQuestions(sondage.questions))
  }, [sondage])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/sondages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || null,
          anonymous,
          deadline:     deadline ? `${deadline}T23:59:59.000Z` : null,
          recipientMode,
          recipientIds: recipientMode === "SELECTED" ? recipientIds : undefined,
          questions:   questions.map(q => ({
            clientKey: q._key,
            id:        q.id,
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
        throw new Error(d.error ?? "Erreur lors de la sauvegarde")
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sondage", id] })
      qc.invalidateQueries({ queryKey: ["sondages"] })
      toast.success("Modifications enregistrées")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  })

  const activateMutation = useMutation({
    mutationFn: () => fetch(`/api/sondages/${id}/activate`, { method: "POST" }).then(r => {
      if (!r.ok) return r.json().then(d => Promise.reject(new Error(d.error)))
      return r.json()
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sondage", id] })
      qc.invalidateQueries({ queryKey: ["sondages"] })
      toast.success("Sondage activé — les membres peuvent maintenant répondre")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  })

  const closeMutation = useMutation({
    mutationFn: () => fetch(`/api/sondages/${id}/close`, { method: "POST" }).then(r => {
      if (!r.ok) return r.json().then(d => Promise.reject(new Error(d.error)))
      return r.json()
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sondage", id] })
      qc.invalidateQueries({ queryKey: ["sondages"] })
      toast.success("Sondage fermé")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  })

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="h-48 bg-muted rounded-xl" />
      </div>
    )
  }

  if (!sondage) {
    return <p className="text-muted-foreground text-sm">Sondage introuvable.</p>
  }

  const editable = sondage.status !== "FERME"

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { toast.error("Le titre est obligatoire"); return }
    if (questions.length === 0) { toast.error("Ajoutez au moins une question"); return }
    if (recipientMode === "SELECTED" && recipientIds.length === 0) {
      toast.error("Sélectionnez au moins un destinataire")
      return
    }
    saveMutation.mutate()
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button type="button" variant="ghost" size="icon" onClick={() => router.push("/dashboard/sondages")}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="rounded-xl bg-primary/10 p-2.5 shrink-0">
          <ClipboardListIcon className="size-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight truncate">{sondage.title}</h1>
            <Badge variant={STATUS_VARIANT[sondage.status]}>{STATUS_LABEL[sondage.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {sondage._count.reponses} réponse{sondage._count.reponses !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {sondage.status === "BROUILLON" && (
            <Button
              size="sm"
              onClick={() => activateMutation.mutate()}
              loading={activateMutation.isPending}
            >
              <CheckCircleIcon className="mr-1.5 size-4" />
              Activer
            </Button>
          )}
          {sondage.status === "ACTIF" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => closeMutation.mutate()}
              loading={closeMutation.isPending}
            >
              <LockIcon className="mr-1.5 size-4" />
              Fermer
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="edit">
            <PencilIcon className="size-3.5" />
            Questionnaire
          </TabsTrigger>
          <TabsTrigger value="resultats">
            <BarChart2Icon className="size-3.5" />
            Résultats
          </TabsTrigger>
        </TabsList>

        {/* Edit tab */}
        <TabsContent value="edit">
          <form onSubmit={handleSave} className="pt-4 pb-10">
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x">

                {/* Left — metadata */}
                <div className="lg:col-span-2 p-5 space-y-4">
                  <h2 className="text-sm font-semibold">Informations générales</h2>

                  <div className="space-y-1.5">
                    <Label htmlFor="title">Titre <span className="ml-0.5 text-destructive" aria-hidden>*</span></Label>
                    <Input
                      id="title"
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      disabled={!editable}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="desc">Description <span className="text-muted-foreground font-normal">(optionnel)</span></Label>
                    <textarea
                      id="desc"
                      rows={3}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      disabled={!editable}
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none disabled:opacity-60"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="deadline">Date limite <span className="text-muted-foreground font-normal">(optionnel)</span></Label>
                    <Input
                      id="deadline"
                      type="date"
                      value={deadline}
                      onChange={e => setDeadline(e.target.value)}
                      disabled={!editable}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Destinataires</Label>
                    <div className="inline-flex rounded-lg border bg-muted/30 p-0.5 gap-0.5 w-full">
                      {(["ALL", "SELECTED"] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          disabled={!editable}
                          onClick={() => {
                            setRecipientMode(mode)
                            if (mode === "ALL") setRecipientIds([])
                          }}
                          className={cn(
                            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-60",
                            recipientMode === mode
                              ? "bg-background shadow-sm text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {mode === "ALL" ? "Tous les membres" : "Sélection manuelle"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {recipientMode === "SELECTED" && (
                  <div className="rounded-lg border bg-muted/10 overflow-hidden">
                    <div className="relative border-b">
                      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Rechercher un membre…"
                        value={memberSearch}
                        onChange={e => setMemberSearch(e.target.value)}
                        disabled={!editable}
                        className="w-full bg-transparent pl-8 pr-3 py-2 text-sm outline-none disabled:opacity-60"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y">
                      {filteredMembres.length === 0 ? (
                        <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
                          <UsersIcon className="size-4" />
                          {membres.length === 0 ? "Chargement…" : "Aucun résultat"}
                        </div>
                      ) : (
                        filteredMembres.map(m => {
                          const checked = recipientIds.includes(m.id)
                          return (
                            <button
                              key={m.id}
                              type="button"
                              disabled={!editable}
                              onClick={() => toggleMembre(m.id)}
                              className={cn(
                                "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 disabled:pointer-events-none",
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
                          {recipientIds.length} membre{recipientIds.length > 1 ? "s" : ""} sélectionné{recipientIds.length > 1 ? "s" : ""}
                        </span>
                        {editable && (
                          <button
                            type="button"
                            onClick={() => setRecipientIds([])}
                            className="text-xs text-muted-foreground hover:text-foreground underline"
                          >
                            Tout désélectionner
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <label className={`flex items-center gap-2.5 cursor-pointer select-none text-sm ${!editable ? "opacity-60 pointer-events-none" : ""}`}>
                    <input
                      type="checkbox"
                      checked={anonymous}
                      onChange={e => setAnonymous(e.target.checked)}
                      className="rounded accent-foreground"
                      disabled={!editable}
                    />
                    Réponses anonymes
                  </label>
                </div>

                {/* Right — questions */}
                <div className="lg:col-span-3 p-5 space-y-3">
                  <h2 className="text-sm font-semibold">Questions <span className="ml-0.5 text-destructive" aria-hidden>*</span></h2>
                  {editable ? (
                    <SondageFormBuilder
                      key={sondage.id}
                      initialQuestions={toBuilderQuestions(sondage.questions)}
                      onChange={setQuestions}
                    />
                  ) : (
                    <div className="space-y-2">
                      {sondage.questions.map((q, i) => (
                        <div key={q.id} className="rounded-xl border bg-card p-4 text-sm">
                          <span className="text-muted-foreground mr-2">{i + 1}.</span>
                          <span className="font-medium">{q.label}</span>
                          {q.required && <span className="text-destructive ml-1">*</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {editable && (
                <div className="border-t px-5 py-3 bg-muted/20 flex justify-end">
                  <Button type="submit" loading={saveMutation.isPending}>
                    Enregistrer
                  </Button>
                </div>
              )}
            </div>
          </form>
        </TabsContent>

        {/* Resultats tab */}
        <TabsContent value="resultats">
          <div className="pt-4 space-y-4">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => refetchResultats()} disabled={resultatsLoading}>
                <RefreshCwIcon className={`mr-1.5 size-3.5 ${resultatsLoading ? "animate-spin" : ""}`} />
                Actualiser
              </Button>
            </div>
            {resultatsLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map(i => (
                  <div key={i} className="rounded-xl border p-5 animate-pulse space-y-3">
                    <div className="h-4 w-40 bg-muted rounded" />
                    <div className="h-24 bg-muted rounded" />
                  </div>
                ))}
              </div>
            ) : resultats ? (
              <SondageResultats data={resultats} />
            ) : null}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
