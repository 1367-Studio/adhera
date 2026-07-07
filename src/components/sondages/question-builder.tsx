"use client"

import { useId } from "react"
import { CaretUpIcon, CaretDownIcon, TrashIcon, PlusIcon, GitBranchIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import {
  QUESTION_TYPE_LABELS, QUESTION_TYPES, CONDITIONAL_TRIGGER_TYPES,
  type QuestionType, type QuestionCondition,
} from "@/lib/sondages/types"
import type { BuilderQuestion } from "./sondage-form-builder"
import { cn } from "@/lib/utils"

interface QuestionBuilderProps {
  question:    BuilderQuestion
  index:       number
  total:       number
  allQuestions: BuilderQuestion[]
  onChange:    (q: BuilderQuestion) => void
  onMoveUp:   () => void
  onMoveDown: () => void
  onDelete:   () => void
}

export function QuestionBuilder({
  question, index, total, allQuestions, onChange, onMoveUp, onMoveDown, onDelete,
}: QuestionBuilderProps) {
  const uid = useId()

  function update(patch: Partial<BuilderQuestion>) {
    onChange({ ...question, ...patch })
  }

  function updateOption(i: number, val: string) {
    const opts = [...(question.options ?? [])]
    opts[i] = val
    update({ options: opts })
  }

  function addOption() {
    update({ options: [...(question.options ?? []), ""] })
  }

  function removeOption(i: number) {
    update({ options: (question.options ?? []).filter((_, j) => j !== i) })
  }

  // Questions that can trigger conditions (before this question, not itself)
  const triggerCandidates = allQuestions.filter(
    (q, i) => i < index && CONDITIONAL_TRIGGER_TYPES.includes(q.type),
  )

  const conditionTrigger = question.condition
    ? allQuestions.find(q => q._key === question.condition?.questionId)
    : null

  const conditionOptions: string[] =
    conditionTrigger?.type === "YES_NO"
      ? ["OUI", "NON"]
      : (conditionTrigger?.options ?? [])

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start gap-2">
        <span className="shrink-0 mt-1 text-xs font-semibold text-muted-foreground w-5 text-right">
          {index + 1}.
        </span>

        <div className="flex-1 space-y-2">
          {/* Label */}
          <input
            type="text"
            placeholder="Question…"
            value={question.label}
            onChange={e => update({ label: e.target.value })}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring font-medium"
          />

          {/* Type selector */}
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={question.type}
              onChange={e => {
                const t = e.target.value as QuestionType
                update({
                  type:      t,
                  options:   ["SINGLE_CHOICE", "MULTIPLE_CHOICE"].includes(t) ? (question.options ?? ["", ""]) : null,
                  condition: null,
                })
              }}
              className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              {QUESTION_TYPES.map(t => (
                <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>
              ))}
            </select>

            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={question.required}
                onChange={e => update({ required: e.target.checked })}
                className="rounded accent-foreground"
              />
              Obligatoire
            </label>
          </div>
        </div>

        {/* Move + delete */}
        <div className="flex flex-col gap-1 shrink-0">
          <button
            type="button"
            disabled={index === 0}
            onClick={onMoveUp}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
          >
            <CaretUpIcon className="size-4" />
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={onMoveDown}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
          >
            <CaretDownIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          >
            <TrashIcon className="size-4" />
          </button>
        </div>
      </div>

      {/* Options list (SINGLE_CHOICE, MULTIPLE_CHOICE) */}
      {(question.type === "SINGLE_CHOICE" || question.type === "MULTIPLE_CHOICE") && (
        <div className="pl-7 space-y-2">
          {(question.options ?? []).map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-4">
                {question.type === "SINGLE_CHOICE" ? "○" : "☐"}
              </span>
              <input
                type="text"
                value={opt}
                placeholder={`Option ${i + 1}`}
                onChange={e => updateOption(i, e.target.value)}
                className="flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                disabled={(question.options ?? []).length <= 2}
                onClick={() => removeOption(i)}
                className="text-muted-foreground hover:text-destructive disabled:opacity-30"
              >
                <TrashIcon className="size-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addOption}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground pl-6"
          >
            <PlusIcon className="size-3" /> Ajouter une option
          </button>
        </div>
      )}

      {/* Conditional logic */}
      {triggerCandidates.length > 0 && (
        <div className="pl-7">
          <details open={!!question.condition}>
            <summary className={cn(
              "flex items-center gap-1.5 text-xs cursor-pointer select-none w-fit",
              question.condition ? "text-violet-600 dark:text-violet-400 font-medium" : "text-muted-foreground hover:text-foreground",
            )}>
              <GitBranchIcon className="size-3.5" />
              {question.condition ? "Logique conditionnelle active" : "Ajouter une condition d'affichage"}
            </summary>

            <div className="mt-3 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20 p-3 space-y-3">
              <p className="text-xs font-medium text-violet-700 dark:text-violet-400">
                Afficher cette question uniquement si :
              </p>

              <div className="flex flex-wrap gap-2 items-center text-sm">
                {/* Question selector */}
                <select
                  value={question.condition?.questionId ?? ""}
                  onChange={e => {
                    const qKey = e.target.value
                    if (!qKey) { update({ condition: null }); return }
                    const trigger = allQuestions.find(q => q._key === qKey)
                    const defaultValue = trigger?.type === "YES_NO" ? "OUI" : (trigger?.options?.[0] ?? "")
                    update({
                      condition: {
                        questionId: qKey,
                        operator:   trigger?.type === "MULTIPLE_CHOICE" ? "includes" : "eq",
                        value:      defaultValue,
                      },
                    })
                  }}
                  className="rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-violet-400 max-w-[180px]"
                >
                  <option value="">— choisir une question —</option>
                  {triggerCandidates.map((q, i) => (
                    <option key={q._key} value={q._key}>
                      Q{allQuestions.indexOf(q) + 1}. {q.label.slice(0, 40)}{q.label.length > 40 ? "…" : ""}
                    </option>
                  ))}
                </select>

                {question.condition && conditionTrigger && (
                  <>
                    {/* Operator */}
                    <select
                      value={question.condition.operator}
                      onChange={e => update({
                        condition: { ...question.condition!, operator: e.target.value as QuestionCondition["operator"] },
                      })}
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-violet-400"
                    >
                      <option value="eq">est égal à</option>
                      <option value="neq">est différent de</option>
                      {conditionTrigger.type === "MULTIPLE_CHOICE" && (
                        <option value="includes">contient</option>
                      )}
                    </select>

                    {/* Value */}
                    <select
                      value={question.condition.value}
                      onChange={e => update({
                        condition: { ...question.condition!, value: e.target.value },
                      })}
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-violet-400 max-w-[160px]"
                    >
                      {conditionOptions.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </>
                )}

                {question.condition && (
                  <button
                    type="button"
                    onClick={() => update({ condition: null })}
                    className="text-xs text-destructive hover:underline"
                  >
                    Supprimer
                  </button>
                )}
              </div>

              {question.condition && (
                <p className="text-xs text-muted-foreground italic">
                  Cette question ne sera visible que si la condition ci-dessus est remplie.
                </p>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  )
}
