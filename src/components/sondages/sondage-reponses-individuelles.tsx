"use client"

import { useState } from "react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { ChevronDownIcon, UserIcon, ShieldIcon, UserXIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type QuestionCondition = {
  questionId: string
  operator:   "eq" | "neq" | "includes"
  value:      string
}

type Question = {
  id:        string
  label:     string
  type:      string
  order:     number
  condition: QuestionCondition | null
}

type ReponseItem = {
  questionId: string
  value:      string | null
}

type Reponse = {
  id:            string
  index:         number
  membre:        { firstName: string; lastName: string } | null
  memberDeleted: boolean
  submittedAt:   string
  items:         ReponseItem[]
}

type IndividuellesData = {
  anonymous: boolean
  questions: Question[]
  reponses:  Reponse[]
}

function wasQuestionShown(condition: QuestionCondition | null, items: ReponseItem[]): boolean {
  if (!condition) return true
  const item = items.find(i => i.questionId === condition.questionId)
  const ans = item?.value ?? null
  if (!ans) return false
  if (condition.operator === "eq")  return ans === condition.value
  if (condition.operator === "neq") return ans !== condition.value
  if (condition.operator === "includes") {
    try { return (JSON.parse(ans) as string[]).includes(condition.value) }
    catch { return false }
  }
  return true
}

function formatValue(value: string | null, type: string): string {
  if (!value) return "—"
  if (type === "MULTIPLE_CHOICE") {
    try {
      const parsed = JSON.parse(value) as string[]
      return parsed.length === 0 ? "—" : parsed.join(", ")
    } catch { return value }
  }
  if (type === "YES_NO") return value === "OUI" ? "Oui" : "Non"
  if (type === "RATING")  return `${value} / 5`
  return value
}

function ReponseCard({ reponse, questions, anonymous }: {
  reponse:   Reponse
  questions: Question[]
  anonymous: boolean
}) {
  const [open, setOpen] = useState(false)

  const shownQuestions  = questions.filter(q => wasQuestionShown(q.condition, reponse.items))
  const answeredCount   = shownQuestions.filter(q => {
    const item = reponse.items.find(i => i.questionId === q.id)
    return !!item?.value
  }).length

  const { name, icon } = (() => {
    if (anonymous)              return { name: `Répondant #${reponse.index}`, icon: <ShieldIcon className="size-4 text-muted-foreground" /> }
    if (reponse.memberDeleted)  return { name: "Membre supprimé",             icon: <UserXIcon  className="size-4 text-muted-foreground/60" /> }
    if (reponse.membre)         return { name: `${reponse.membre.firstName} ${reponse.membre.lastName}`, icon: <UserIcon className="size-4 text-muted-foreground" /> }
    return { name: `Répondant #${reponse.index}`, icon: <UserIcon className="size-4 text-muted-foreground" /> }
  })()

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
      >
        <div className="size-8 rounded-full bg-muted flex items-center justify-center shrink-0">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn("text-sm font-medium truncate", reponse.memberDeleted && "italic text-muted-foreground")}>
            {name}
          </p>
          <p className="text-xs text-muted-foreground">
            {format(new Date(reponse.submittedAt), "d MMM yyyy à HH:mm", { locale: fr })}
            {" · "}{answeredCount} / {shownQuestions.length} question{shownQuestions.length !== 1 ? "s" : ""} répondue{answeredCount !== 1 ? "s" : ""}
          </p>
        </div>
        <ChevronDownIcon
          className={cn("size-4 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t divide-y">
          {questions.map((q, i) => {
            const shown = wasQuestionShown(q.condition, reponse.items)
            const item  = reponse.items.find(it => it.questionId === q.id)
            const val   = shown ? formatValue(item?.value ?? null, q.type) : null

            return (
              <div key={q.id} className="px-4 py-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <span className="text-xs text-muted-foreground pt-0.5 tabular-nums">Q{i + 1}</span>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{q.label}</p>
                  {shown ? (
                    <p className={cn("text-sm mt-0.5", val === "—" && "text-muted-foreground italic")}>{val}</p>
                  ) : (
                    <p className="text-xs mt-0.5 text-muted-foreground/60 italic">Question non posée</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface SondageRepondesIndividuellesProps {
  data: IndividuellesData
}

export function SondageRepondesIndividuelles({ data }: SondageRepondesIndividuellesProps) {
  const [search, setSearch] = useState("")

  const filtered = data.reponses.filter(r => {
    if (!search || data.anonymous) return true
    const q = search.toLowerCase()
    if (r.memberDeleted) return false
    const name = r.membre ? `${r.membre.firstName} ${r.membre.lastName}`.toLowerCase() : ""
    return name.includes(q)
  })

  if (data.reponses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center space-y-2">
        <UserIcon className="size-10 text-muted-foreground/50 mx-auto" />
        <p className="text-sm text-muted-foreground">Aucune réponse pour le moment.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {data.anonymous && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
          <ShieldIcon className="size-3.5 shrink-0" />
          Ce sondage est anonyme — les noms des répondants ne sont pas affichés.
        </div>
      )}

      {!data.anonymous && (
        <input
          type="text"
          placeholder="Rechercher un répondant…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      )}

      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{filtered.length}</span> réponse{filtered.length !== 1 ? "s" : ""}
        {search && !data.anonymous && ` pour "${search}"`}
      </p>

      <div className="space-y-2">
        {filtered.map(r => (
          <ReponseCard
            key={r.id}
            reponse={r}
            questions={data.questions}
            anonymous={data.anonymous}
          />
        ))}
      </div>
    </div>
  )
}
