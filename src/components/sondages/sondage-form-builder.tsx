"use client"

import { useState, useCallback } from "react"
import { PlusIcon, ClipboardListIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { QuestionBuilder } from "./question-builder"
import type { QuestionType, QuestionCondition } from "@/lib/sondages/types"

export type BuilderQuestion = {
  _key:      string  // local client key (may be a temp id for new questions)
  id?:       string  // DB id, only set when editing
  type:      QuestionType
  label:     string
  required:  boolean
  order:     number
  options:   string[] | null
  condition: QuestionCondition | null
}

let _seq = 0
function genKey() { return `q_${++_seq}_${Date.now()}` }

function makeQuestion(order: number): BuilderQuestion {
  return { _key: genKey(), type: "TEXT_SHORT", label: "", required: false, order, options: null, condition: null }
}

interface SondageFormBuilderProps {
  initialQuestions?: BuilderQuestion[]
  onChange:          (questions: BuilderQuestion[]) => void
}

export function SondageFormBuilder({ initialQuestions, onChange }: SondageFormBuilderProps) {
  const [questions, setQuestions] = useState<BuilderQuestion[]>(
    initialQuestions ?? [makeQuestion(0)],
  )

  function update(qs: BuilderQuestion[]) {
    const reordered = qs.map((q, i) => ({ ...q, order: i }))
    setQuestions(reordered)
    onChange(reordered)
  }

  function addQuestion() {
    update([...questions, makeQuestion(questions.length)])
  }

  function updateQuestion(index: number, q: BuilderQuestion) {
    const next = [...questions]
    next[index] = q
    update(next)
  }

  function deleteQuestion(index: number) {
    update(questions.filter((_, i) => i !== index))
  }

  function moveUp(index: number) {
    if (index === 0) return
    const next = [...questions]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    // Clean up conditions that point to questions now after the moved question
    update(next.map((q, i) => {
      if (!q.condition) return q
      const targetIdx = next.findIndex(x => x._key === q.condition!.questionId)
      return targetIdx >= i ? { ...q, condition: null } : q
    }))
  }

  function moveDown(index: number) {
    if (index === questions.length - 1) return
    const next = [...questions]
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
    update(next.map((q, i) => {
      if (!q.condition) return q
      const targetIdx = next.findIndex(x => x._key === q.condition!.questionId)
      return targetIdx >= i ? { ...q, condition: null } : q
    }))
  }

  return (
    <div className="space-y-3">
      {questions.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground space-y-2">
          <ClipboardListIcon className="size-8 mx-auto text-muted-foreground/50" />
          <p>Aucune question. Ajoutez-en une ci-dessous.</p>
        </div>
      ) : (
        questions.map((q, i) => (
          <QuestionBuilder
            key={q._key}
            question={q}
            index={i}
            total={questions.length}
            allQuestions={questions}
            onChange={updated => updateQuestion(i, updated)}
            onMoveUp={() => moveUp(i)}
            onMoveDown={() => moveDown(i)}
            onDelete={() => deleteQuestion(i)}
          />
        ))
      )}

      <Button type="button" variant="outline" size="sm" onClick={addQuestion} className="gap-1.5">
        <PlusIcon className="size-4" />
        Ajouter une question
      </Button>
    </div>
  )
}
