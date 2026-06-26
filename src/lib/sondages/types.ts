export type QuestionType =
  | "TEXT_SHORT"
  | "TEXT_LONG"
  | "SINGLE_CHOICE"
  | "MULTIPLE_CHOICE"
  | "RATING"
  | "YES_NO"

export type SondageStatus = "BROUILLON" | "ACTIF" | "FERME"

// Condition: show this question only when another question has a specific answer
export type QuestionCondition = {
  questionId: string
  // eq = equals (SINGLE_CHOICE, YES_NO), includes = value is in selected list (MULTIPLE_CHOICE)
  operator:   "eq" | "neq" | "includes"
  value:      string
}

export type SondageQuestion = {
  id:        string
  type:      QuestionType
  label:     string
  required:  boolean
  order:     number
  options:   string[] | null
  condition: QuestionCondition | null
}

export type SondageSummary = {
  id:           string
  title:        string
  description:  string | null
  status:       SondageStatus
  recipientMode: string
  anonymous:    boolean
  deadline:     string | null
  createdAt:    string
  _count:       { reponses: number; questions: number }
}

export type SondageDetail = SondageSummary & {
  questions:   SondageQuestion[]
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  TEXT_SHORT:      "Texte court",
  TEXT_LONG:       "Texte long",
  SINGLE_CHOICE:   "Choix unique",
  MULTIPLE_CHOICE: "Choix multiple",
  RATING:          "Évaluation (1–5)",
  YES_NO:          "Oui / Non",
}

export const QUESTION_TYPES: QuestionType[] = [
  "TEXT_SHORT",
  "TEXT_LONG",
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "RATING",
  "YES_NO",
]

// Types that can trigger conditional logic on other questions
export const CONDITIONAL_TRIGGER_TYPES: QuestionType[] = [
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "YES_NO",
]
