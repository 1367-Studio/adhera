import { describe, expect, it } from "vitest"
import { answersWithMobile, readMobileAnswer } from "@/lib/membre-answers"

// Membre.answers porte le mobile ET les réponses aux champs personnalisés du formulaire
// d'adhésion. Le risque à couvrir est toujours le même : qu'une écriture du mobile emporte
// les autres réponses, ou qu'un formulaire d'édition qui ignore le champ efface le numéro.
const CHAMPS_PERSONNALISES = { "clx-profession": "Boulanger", "clx-taille": "M" }

describe("readMobileAnswer", () => {
  it("lit le mobile quand il est là", () => {
    expect(readMobileAnswer({ mobile: "06 12 34 56 78" })).toBe("06 12 34 56 78")
  })

  it("answers absent, vide ou sans mobile → null", () => {
    expect(readMobileAnswer(null)).toBeNull()
    expect(readMobileAnswer({})).toBeNull()
    expect(readMobileAnswer(CHAMPS_PERSONNALISES)).toBeNull()
  })

  it("une chaîne vide ou blanche ne compte pas comme un numéro", () => {
    expect(readMobileAnswer({ mobile: "" })).toBeNull()
    expect(readMobileAnswer({ mobile: "   " })).toBeNull()
  })

  it("une valeur non-texte est ignorée plutôt que rendue telle quelle", () => {
    expect(readMobileAnswer({ mobile: 612345678 })).toBeNull()
  })
})

describe("answersWithMobile", () => {
  it("ajoute le mobile sans toucher aux réponses des champs personnalisés", () => {
    expect(answersWithMobile(CHAMPS_PERSONNALISES, "06 12 34 56 78"))
      .toEqual({ ...CHAMPS_PERSONNALISES, mobile: "06 12 34 56 78" })
  })

  it("remplace un mobile existant sans rien perdre d'autre", () => {
    const existant = { ...CHAMPS_PERSONNALISES, mobile: "06 00 00 00 00" }
    expect(answersWithMobile(existant, "07 11 22 33 44"))
      .toEqual({ ...CHAMPS_PERSONNALISES, mobile: "07 11 22 33 44" })
  })

  it("un mobile vidé retire la clé, et ne laisse pas une chaîne vide derrière", () => {
    const existant = { ...CHAMPS_PERSONNALISES, mobile: "06 00 00 00 00" }
    expect(answersWithMobile(existant, "")).toEqual(CHAMPS_PERSONNALISES)
    expect(readMobileAnswer(answersWithMobile(existant, ""))).toBeNull()
  })

  it("part d'un answers absent sans planter", () => {
    expect(answersWithMobile(null, "06 12 34 56 78")).toEqual({ mobile: "06 12 34 56 78" })
    expect(answersWithMobile(undefined, "")).toEqual({})
  })

  it("nettoie les espaces autour du numéro", () => {
    expect(answersWithMobile(null, "  06 12 34 56 78  ")).toEqual({ mobile: "06 12 34 56 78" })
  })

  it("ne modifie pas l'objet reçu", () => {
    const existant = { ...CHAMPS_PERSONNALISES, mobile: "06 00 00 00 00" }
    answersWithMobile(existant, "07 11 22 33 44")
    expect(existant.mobile).toBe("06 00 00 00 00")
  })
})
