// FORM-132 — shared between the sweep that builds the email links
// (src/app/api/cron/churn-feedback-sweep/route.ts) and the public confirmation page
// (src/app/churn-feedback/[token]/page.tsx), so both always agree on the exact wording for a
// given code instead of drifting apart as two separately-maintained copies.
export const CHURN_REASONS: { code: string; label: string }[] = [
  { code: "sem_tempo",     label: "Je n'ai pas eu le temps de configurer" },
  { code: "complicado",    label: "J'ai trouvé ça compliqué à utiliser" },
  { code: "nao_resolvia",  label: "Je n'étais pas sûr que ça réponde à mon besoin" },
  { code: "preco",         label: "Le prix" },
  { code: "outra_solucao", label: "J'ai trouvé une autre solution" },
]

export const CHURN_REASON_LABEL_BY_CODE: Record<string, string> =
  Object.fromEntries(CHURN_REASONS.map(r => [r.code, r.label]))
