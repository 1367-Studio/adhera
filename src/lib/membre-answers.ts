// Membre.answers est keyé soit par la clé fixe "mobile", soit par un id de
// MembershipFormField (voir Membre.answers dans schema.prisma). Le mobile n'a pas de colonne
// dédiée sur Membre, contrairement au téléphone fixe : il vit dans ce Json.
export const MOBILE_ANSWER_KEY = "mobile"

export function readMobileAnswer(answers: unknown): string | null {
  const value = (answers as Record<string, unknown> | null)?.[MOBILE_ANSWER_KEY]
  return typeof value === "string" && value.trim() ? value : null
}

// Patche une ou plusieurs clés dans answers sans jamais remplacer l'objet : le mobile et les
// réponses aux champs personnalisés du formulaire d'adhésion vivent dans le même Json, et
// corriger l'un depuis la fiche ne doit pas effacer les autres au passage. Une valeur vidée
// retire sa clé plutôt que d'y laisser une chaîne vide, pour que readMobileAnswer (et tout
// lecteur équivalent pour un champ personnalisé) reste d'accord avec l'export sur ce que
// « pas de réponse » veut dire.
export function mergeAnswers(existingAnswers: unknown, updates: Record<string, string | null | undefined>): Record<string, string> {
  const answers = { ...(existingAnswers as Record<string, string> | null ?? {}) }
  for (const [key, rawValue] of Object.entries(updates)) {
    const trimmedValue = rawValue?.trim()
    if (trimmedValue) answers[key] = trimmedValue
    else delete answers[key]
  }
  return answers
}

export function answersWithMobile(existingAnswers: unknown, mobile: string | null | undefined): Record<string, string> {
  return mergeAnswers(existingAnswers, { [MOBILE_ANSWER_KEY]: mobile })
}
