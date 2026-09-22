// Membre.answers est keyé soit par la clé fixe "mobile", soit par un id de
// MembershipFormField (voir Membre.answers dans schema.prisma). Le mobile n'a pas de colonne
// dédiée sur Membre, contrairement au téléphone fixe : il vit dans ce Json.
export const MOBILE_ANSWER_KEY = "mobile"

export function readMobileAnswer(answers: unknown): string | null {
  const value = (answers as Record<string, unknown> | null)?.[MOBILE_ANSWER_KEY]
  return typeof value === "string" && value.trim() ? value : null
}

// Patche le mobile dans answers sans jamais remplacer l'objet : les réponses aux champs
// personnalisés du formulaire d'adhésion vivent dans le même Json, et un admin qui corrige un
// numéro depuis la fiche ne doit pas les effacer au passage. Un mobile vidé retire la clé
// plutôt que d'y laisser une chaîne vide, pour que readMobileAnswer et l'export restent
// d'accord sur ce que « pas de mobile » veut dire.
export function answersWithMobile(existingAnswers: unknown, mobile: string | null | undefined): Record<string, string> {
  const answers = { ...(existingAnswers as Record<string, string> | null ?? {}) }
  const trimmedMobile = mobile?.trim()
  if (trimmedMobile) answers[MOBILE_ANSWER_KEY] = trimmedMobile
  else delete answers[MOBILE_ANSWER_KEY]
  return answers
}
