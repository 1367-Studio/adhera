"use client"

import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
} from "recharts"
import { StarIcon, ChatIcon, UsersIcon } from "@phosphor-icons/react/dist/ssr";
type TextResult = {
  questionId: string
  type:       "TEXT_SHORT" | "TEXT_LONG"
  label:      string
  count:      number
  answers:    string[]
}

type ChoiceResult = {
  questionId: string
  type:       "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "YES_NO"
  label:      string
  count:      number
  choices:    { label: string; count: number }[]
}

type RatingResult = {
  questionId:   string
  type:         "RATING"
  label:        string
  count:        number
  avg:          number | null
  distribution: { star: number; count: number }[]
}

type QuestionResult = TextResult | ChoiceResult | RatingResult

type ResultatsData = {
  totalReponses: number
  questions:     QuestionResult[]
}

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"]

function ChartTooltip({ active, payload, label, formatter }: {
  active?:    boolean
  payload?:   { name: string; value: number }[]
  label?:     string
  formatter?: (v: number) => string
}) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  const header   = label ?? p.name
  const valueStr = formatter ? formatter(p.value) : String(p.value)
  return (
    <div className="rounded-lg border bg-card text-card-foreground px-3 py-2 shadow-md text-xs space-y-0.5">
      <p className="font-semibold">{header}</p>
      <p className="text-muted-foreground">
        {label ? `${p.name}: ` : ""}
        <span className="font-medium text-card-foreground">{valueStr}</span>
      </p>
    </div>
  )
}

function ChoiceChart({ result }: { result: ChoiceResult }) {
  const total = result.choices.reduce((s, c) => s + c.count, 0)
  const data  = result.choices.map(c => ({ name: c.label, value: c.count }))

  if (result.type === "YES_NO" || result.choices.length <= 4) {
    return (
      <div className="flex gap-6 items-center">
        <div className="w-[180px] h-[180px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip formatter={v => `${v} (${total ? Math.round(v / total * 100) : 0}%)`} />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-2">
          {data.map((d, i) => (
            <div key={d.name} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full inline-block" style={{ background: COLORS[i % COLORS.length] }} />
                  {d.name}
                </span>
                <span className="font-medium">{d.value}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${total ? d.value / total * 100 : 0}%`, background: COLORS[i % COLORS.length] }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
          <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: "currentColor", fillOpacity: 0.06 }} content={<ChartTooltip />} />
          <Bar dataKey="value" fill={COLORS[0]} radius={[0, 4, 4, 0]} name="Réponses" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function RatingChart({ result }: { result: RatingResult }) {
  const data = result.distribution.map(d => ({ name: `${d.star}★`, value: d.count }))
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-3xl font-bold">{result.avg?.toFixed(1) ?? "—"}</span>
        <div className="flex gap-0.5">
          {[1, 2, 3, 4, 5].map(star => (
            <StarIcon
              key={star}
              className="size-5"
              fill={result.avg && star <= Math.round(result.avg) ? "#f59e0b" : "none"}
              stroke="#f59e0b"
            />
          ))}
        </div>
        <span className="text-sm text-muted-foreground">{result.count} réponse{result.count !== 1 ? "s" : ""}</span>
      </div>
      <div className="h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip cursor={{ fill: "currentColor", fillOpacity: 0.06 }} content={<ChartTooltip />} />
            <Bar dataKey="value" fill={COLORS[0]} radius={[4, 4, 0, 0]} name="Réponses" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function TextAnswers({ result }: { result: TextResult }) {
  if (result.answers.length === 0) {
    return <p className="text-sm text-muted-foreground italic">Aucune réponse textuelle.</p>
  }
  return (
    <div className="space-y-2 max-h-56 overflow-y-auto pr-2">
      {result.answers.map((ans, i) => (
        <div key={i} className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          {ans}
        </div>
      ))}
    </div>
  )
}

interface SondageResultatsProps {
  data: ResultatsData
}

export function SondageResultats({ data }: SondageResultatsProps) {
  if (data.totalReponses === 0) {
    return (
      <div className="rounded-xl border border-dashed p-12 text-center space-y-2">
        <UsersIcon className="size-10 text-muted-foreground/50 mx-auto" />
        <p className="text-sm text-muted-foreground">Aucune réponse pour le moment.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">{data.totalReponses}</span> réponse{data.totalReponses !== 1 ? "s" : ""} reçue{data.totalReponses !== 1 ? "s" : ""}
      </p>

      {data.questions.map((q, i) => (
        <div key={q.questionId} className="rounded-xl border bg-card p-5 space-y-4">
          <div>
            <p className="text-xs text-muted-foreground">Q{i + 1}</p>
            <p className="font-semibold text-sm">{q.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{q.count} réponse{q.count !== 1 ? "s" : ""}</p>
          </div>

          {(q.type === "TEXT_SHORT" || q.type === "TEXT_LONG") && (
            <TextAnswers result={q as TextResult} />
          )}

          {(q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CHOICE" || q.type === "YES_NO") && (
            <ChoiceChart result={q as ChoiceResult} />
          )}

          {q.type === "RATING" && (
            <RatingChart result={q as RatingResult} />
          )}
        </div>
      ))}
    </div>
  )
}
