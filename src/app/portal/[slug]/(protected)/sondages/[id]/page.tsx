"use client";

import { useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowLeftIcon, CheckCircleIcon, StarIcon, ClipboardTextIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type QuestionCondition = {
  questionId: string;
  operator: "eq" | "neq" | "includes";
  value: string;
};

type Question = {
  id: string;
  type:
    | "TEXT_SHORT"
    | "TEXT_LONG"
    | "SINGLE_CHOICE"
    | "MULTIPLE_CHOICE"
    | "RATING"
    | "YES_NO";
  label: string;
  required: boolean;
  order: number;
  options: string[] | null;
  condition: QuestionCondition | null;
};

type SondageDetail = {
  id: string;
  title: string;
  description: string | null;
  anonymous: boolean;
  deadline: string | null;
  questions: Question[];
  repondu: boolean;
};

type Answers = Record<string, string | string[] | null>;

function isVisible(q: Question, answers: Answers): boolean {
  if (!q.condition) return true;
  const { questionId, operator, value } = q.condition;
  const ans = answers[questionId];
  if (ans === null || ans === undefined) return false;

  if (operator === "eq") return ans === value;
  if (operator === "neq") return ans !== value;
  if (operator === "includes")
    return Array.isArray(ans) ? ans.includes(value) : false;

  return true;
}

function RatingInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string) => void;
}) {
  const rating = value ? parseInt(value, 10) : 0;
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(String(star))}
          className="p-0.5 focus:outline-none"
          aria-label={`${star} étoile${star > 1 ? "s" : ""}`}
        >
          <StarIcon
            className="size-8 transition-colors"
            fill={star <= rating ? "#f59e0b" : "transparent"}
            stroke={star <= rating ? "#f59e0b" : "currentColor"}
          />
        </button>
      ))}
      {rating > 0 && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="ml-2 text-xs text-muted-foreground hover:text-foreground"
        >
          Effacer
        </button>
      )}
    </div>
  );
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: Answers[string];
  onChange: (v: string | string[] | null) => void;
}) {
  const str = typeof value === "string" ? value : "";

  if (question.type === "TEXT_SHORT") {
    return (
      <input
        type="text"
        value={str}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Votre réponse…"
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
    );
  }

  if (question.type === "TEXT_LONG") {
    return (
      <textarea
        rows={4}
        value={str}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Votre réponse…"
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
      />
    );
  }

  if (question.type === "YES_NO") {
    return (
      <div className="flex gap-3">
        {["OUI", "NON"].map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(value === opt ? null : opt)}
            className={`px-6 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              value === opt
                ? "border-ring bg-background shadow-sm text-foreground"
                : "border-input text-muted-foreground hover:border-ring/50 hover:text-foreground"
            }`}
          >
            {opt === "OUI" ? "Oui" : "Non"}
          </button>
        ))}
      </div>
    );
  }

  if (question.type === "SINGLE_CHOICE") {
    return (
      <div className="space-y-2">
        {(question.options ?? []).map((opt) => (
          <label
            key={opt}
            className="flex items-center gap-3 cursor-pointer group"
          >
            <div
              className={`size-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                value === opt
                  ? "border-primary"
                  : "border-muted-foreground/40 group-hover:border-primary/60"
              }`}
            >
              {value === opt && (
                <div className="size-2 rounded-full bg-primary" />
              )}
            </div>
            <input
              type="radio"
              className="sr-only"
              checked={value === opt}
              onChange={() => onChange(opt)}
            />
            <span className="text-sm">{opt}</span>
          </label>
        ))}
      </div>
    );
  }

  if (question.type === "MULTIPLE_CHOICE") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-2">
        {(question.options ?? []).map((opt) => {
          const checked = selected.includes(opt);
          return (
            <label
              key={opt}
              className="flex items-center gap-3 cursor-pointer group"
            >
              <div
                className={`size-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                  checked
                    ? "border-primary bg-primary"
                    : "border-muted-foreground/40 group-hover:border-primary/60"
                }`}
              >
                {checked && (
                  <svg
                    className="size-2.5 text-primary-foreground"
                    viewBox="0 0 10 10"
                    fill="none"
                  >
                    <path
                      d="M1.5 5L4 7.5L8.5 2.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((s) => s !== opt)
                      : [...selected, opt],
                  )
                }
              />
              <span className="text-sm">{opt}</span>
            </label>
          );
        })}
      </div>
    );
  }

  if (question.type === "RATING") {
    return (
      <RatingInput value={str || null} onChange={(v) => onChange(v || null)} />
    );
  }

  return null;
}

export default function SondageFormPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>({});
  const [submitted, setSubmitted] = useState(false);

  const {
    data: sondage,
    isLoading,
    error,
  } = useQuery<SondageDetail>({
    queryKey: ["portal-sondage", id],
    queryFn: () =>
      fetch(`/api/portal/sondages/${id}`).then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Erreur");
        return r.json();
      }),
    staleTime: 0,
  });

  const visibleQuestions = useMemo(
    () => (sondage?.questions ?? []).filter((q) => isVisible(q, answers)),
    [sondage, answers],
  );

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/portal/sondages/${id}/repondre`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Erreur lors de l'envoi");
      }
      return res.json();
    },
    onSuccess: () => setSubmitted(true),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sondage) return;

    for (const q of visibleQuestions) {
      if (!q.required) continue;
      const ans = answers[q.id];
      const empty =
        ans === null ||
        ans === undefined ||
        ans === "" ||
        (Array.isArray(ans) && ans.length === 0);
      if (empty) {
        toast.error(`La question "${q.label}" est obligatoire`);
        return;
      }
    }
    submitMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="h-48 bg-muted rounded-xl" />
      </div>
    );
  }

  if (error || !sondage) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          {error instanceof Error ? error.message : "Sondage introuvable."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push(`/portal/${slug}/sondages`)}
        >
          <ArrowLeftIcon className="mr-1.5 size-4" />
          Retour aux sondages
        </Button>
      </div>
    );
  }

  if (sondage.repondu || submitted) {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border bg-card p-8 text-center space-y-4 max-w-lg mx-auto mt-8">
          <div className="size-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto">
            <CheckCircleIcon className="size-7 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Réponse enregistrée !</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Merci d'avoir participé à ce sondage.
              {sondage.anonymous &&
                " Vos réponses ont été enregistrées anonymement."}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => router.push(`/portal/${slug}/sondages`)}
          >
            Retour aux sondages
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => router.push(`/portal/${slug}/sondages`)}
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="rounded-xl bg-primary/10 p-2.5 shrink-0">
          <ClipboardTextIcon className="size-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight truncate">
              {sondage.title}
            </h1>
            {sondage.anonymous && (
              <Badge variant="outline" className="text-xs">
                Anonyme
              </Badge>
            )}
          </div>
          {(sondage.description || sondage.deadline) && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {sondage.description}
              {sondage.deadline && (
                <span className={sondage.description ? " · " : ""}>
                  Clôture :{" "}
                  {format(new Date(sondage.deadline), "d MMMM yyyy", {
                    locale: fr,
                  })}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Questions */}
      <div className="space-y-4">
        {visibleQuestions.map((q, i) => (
          <div key={q.id} className="rounded-xl border bg-card p-5 space-y-3">
            <div className="flex items-start gap-1.5">
              <span className="text-xs text-muted-foreground font-medium pt-0.5 shrink-0">
                {i + 1}.
              </span>
              <p className="text-sm font-semibold leading-snug">
                {q.label}
                {q.required && <span className="text-destructive ml-1">*</span>}
              </p>
            </div>
            <div className="pl-5">
              <QuestionInput
                question={q}
                value={answers[q.id] ?? null}
                onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
              />
            </div>
          </div>
        ))}
      </div>

      {visibleQuestions.length > 0 && (
        <div className="flex justify-end">
          <Button type="submit" loading={submitMutation.isPending} size="lg">
            Envoyer mes réponses
          </Button>
        </div>
      )}
    </form>
  );
}
