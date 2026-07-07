"use client"

import { useState } from "react"
import { SparkleIcon, XIcon, ArrowElbowDownLeftIcon, ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Action = "generate" | "improve" | "rephrase" | "summarize"

const ACTIONS: { value: Action; label: string; needsText: boolean }[] = [
  { value: "generate",  label: "Générer",    needsText: false },
  { value: "improve",   label: "Améliorer",  needsText: true  },
  { value: "rephrase",  label: "Reformuler", needsText: true  },
  { value: "summarize", label: "Résumer",    needsText: true  },
]

interface AiWriterProps {
  currentText: string
  onInsert:    (text: string) => void
  onReplace:   (text: string) => void
  onClose:     () => void
}

export function AiWriter({ currentText, onInsert, onReplace, onClose }: AiWriterProps) {
  const [action, setAction]           = useState<Action>("generate")
  const [instruction, setInstruction] = useState("")
  const [result, setResult]           = useState("")
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState("")

  const activeAction = ACTIONS.find(a => a.value === action)!
  const hasText      = currentText.trim().length > 10

  async function handleGenerate() {
    setLoading(true)
    setError("")
    setResult("")
    try {
      const res  = await fetch("/api/ai/write", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action, instruction: instruction || undefined, currentText }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Erreur"); return }
      setResult(data.text)
    } catch {
      setError("Erreur réseau")
    } finally {
      setLoading(false)
    }
  }

  const canGenerate = action === "generate" ? !!instruction.trim() : hasText

  return (
    <div className="border-b bg-violet-50/60 dark:bg-violet-950/20 px-3 py-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <SparkleIcon className="size-3.5 text-violet-600 dark:text-violet-400" />
          <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">Assistant IA</span>
        </div>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <XIcon className="size-3.5" />
        </button>
      </div>

      {/* Action tabs */}
      <div className="flex gap-1">
        {ACTIONS.map(a => (
          <button
            key={a.value}
            type="button"
            onClick={() => { setAction(a.value); setResult(""); setError("") }}
            className={cn(
              "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              action === a.value
                ? "bg-violet-600 text-white"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Instruction */}
      <div className="flex gap-2">
        <input
          type="text"
          value={instruction}
          onChange={e => setInstruction(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && canGenerate && !loading) handleGenerate() }}
          placeholder={
            action === "generate"
              ? "Ex : convocation à l'AG du 15 janvier…"
              : "Instruction optionnelle (ex : rend plus formel)…"
          }
          className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-violet-400"
        />
        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={!canGenerate || loading}
          loading={loading}
          className="bg-violet-600 hover:bg-violet-700 text-white shrink-0"
        >
          {!loading && <ArrowElbowDownLeftIcon className="size-3.5" />}
        </Button>
      </div>

      {!hasText && activeAction.needsText && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Écrivez d'abord du texte dans l'éditeur pour utiliser « {activeAction.label} ».
        </p>
      )}

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-2">
          <div className="rounded-md border bg-background px-3 py-2.5 text-sm text-foreground max-h-40 overflow-y-auto whitespace-pre-wrap">
            {result}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => onReplace(result)} className="bg-violet-600 hover:bg-violet-700 text-white">
              Remplacer
            </Button>
            <Button size="sm" variant="outline" onClick={() => onInsert(result)}>
              Insérer
            </Button>
            <Button size="sm" variant="ghost" onClick={handleGenerate} loading={loading} className="ml-auto text-muted-foreground">
              <ArrowsClockwiseIcon className="size-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
