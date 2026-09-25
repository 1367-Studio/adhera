import type { PaperFormField } from "@/lib/schemas"

// DAC Academy's own paper form, « FICHE D'INSCRIPTION 2026 2027 » — two printed pages per
// person ("Page 1/2" identity & courses, "Page 2/2" payment & commitments), DAC Academy logo,
// header "18 rue d'Alsace Le Poulfanc 56860 SÉNÉ". Labels are copied as printed so the vision
// model finds each box; identificationText switches the extract route to strict mode, so any
// page that is not this exact form is refused instead of being read into a member.
//
// Written into the association's templates by scripts/seed-paper-form-dac-academy.ts, which
// first resolves the commitment checkboxes against the association's legal documents.

export const DAC_ACADEMY_TEMPLATE_NAME = "Fiche d'inscription DAC Academy 2026-2027"
export const DAC_ACADEMY_PAGES_PER_FORM = 2
export const DAC_ACADEMY_IDENTIFICATION_TEXT =
  "FICHE D'INSCRIPTION 2026 2027 — DAC Academy (18 rue d'Alsace Le Poulfanc 56860 Séné)"

// The five commitment checkboxes of page 2. Each becomes an acceptance of the matching
// AssociationDocument when one is found (titleKeywords, compared without case or accents),
// otherwise a plain "Oui"/"Non" kept in the member's notes.
export const DAC_ACADEMY_ENGAGEMENTS = [
  { key: "engagement_financier",     label: "Engagement Financier",         titleKeywords: ["engagement financier"] },
  { key: "sante_aptitude",           label: "Santé & Aptitude",             titleKeywords: ["sante", "aptitude"] },
  { key: "propriete_intellectuelle", label: "Propriété Intellectuelle",     titleKeywords: ["propriete intellectuelle"] },
  { key: "reglement_interieur",      label: "Règlement Intérieur",          titleKeywords: ["reglement interieur"] },
  { key: "mediation",                label: "Médiation de la consommation", titleKeywords: ["mediation"] },
] as const

export type DacAcademyEngagementKey = (typeof DAC_ACADEMY_ENGAGEMENTS)[number]["key"]

const PAGE_ONE_FIELDS: PaperFormField[] = [
  {
    key: "nom_prenom", label: "Nom - Prénom", page: 1, target: "fullName",
    hint: "Section Élève. Écrit le plus souvent NOM puis Prénom ; le mot en MAJUSCULES est le nom de famille.",
  },
  {
    key: "date_naissance", label: "Date de naissance", page: 1, target: "birthDate",
    hint: "Section Élève, écrite en JJ/MM/AAAA sur la fiche.",
  },
  {
    key: "telephone", label: "Téléphone", page: 1, target: "phone",
    hint: "Téléphone de l'élève (section Élève), pas celui des parents.",
  },
  {
    key: "email", label: "Email (En MAJUSCULE)", page: 1, target: "email",
    hint: "Écrit en majuscules sur la fiche : attention aux confusions O/0, I/1, S/5.",
  },
  {
    key: "adresse", label: "Adresse", page: 1, target: "address",
    hint: "Adresse de l'élève, souvent sur une ou deux lignes pointillées (rue, code postal, ville).",
  },
  // The two parent lines land on the student's record (guardian* / secondGuardian* columns),
  // not as members of their own.
  {
    key: "mere_nom_prenom", label: "Mère : Nom - Prénom", page: 1, target: "guardianFullName",
    hint: "Ligne « Mère ». Écrit le plus souvent NOM puis Prénom ; le mot en MAJUSCULES est le nom de famille.",
  },
  {
    key: "mere_telephone", label: "Téléphone (mère)", page: 1, target: "guardianPhone",
    hint: "Téléphone sur la ligne « Mère ».",
  },
  {
    key: "pere_nom_prenom", label: "Père : Nom - Prénom", page: 1, target: "secondGuardianFullName",
    hint: "Ligne « Père ». Écrit le plus souvent NOM puis Prénom ; le mot en MAJUSCULES est le nom de famille.",
  },
  {
    key: "pere_telephone", label: "Téléphone (père)", page: 1, target: "secondGuardianPhone",
    hint: "Téléphone sur la ligne « Père ».",
  },
  {
    key: "cours", label: "Cours choisis (discipline / jour / horaire)", page: 1, target: "notes",
    hint: "Jusqu'à 15 lignes pointillées sur 3 colonnes (discipline, jour, horaire). Une ligne remplie = un cours « discipline jour horaire » ; joins les cours par « ; ». Ignore les lignes vides.",
  },
  {
    key: "forfait", label: "Forfait", page: 1, target: "notes",
    hint: "Recopie les options cochées parmi : 1 Cours, 2 Cours, 3 Cours, Illimité, Pole Dance, Pole Sexy Dance, Animateur (plusieurs séparées par « ; »). null si aucune n'est cochée.",
  },
]

const PAYMENT_FIELDS: PaperFormField[] = [
  {
    key: "option_reglement", label: "Option de règlement (1 / 3 / 6 / 9 fois)", page: 2, target: "notes",
    hint: "L'option cochée, recopiée comme « 1 fois », « 3 fois », « 6 fois » ou « 9 fois ».",
  },
  {
    key: "nombre_cheques", label: "Nombre de chèques remis", page: 2, target: "notes",
    hint: "Le nombre écrit, en chiffres.",
  },
  {
    key: "total_a_regler", label: "Total à régler", page: 2, target: "notes",
    hint: "Le montant écrit, avec « € » (ex. « 450 € »).",
  },
  {
    key: "mode_reglement", label: "Mode de règlement", page: 2, target: "notes",
    hint: "Modes cochés parmi Espèces, CB, Chèque, Virement, ANCV, Pass'sport, Autre, chacun avec le montant écrit à côté, séparés par « ; » (ex. « CB 100 € ; ANCV 50 € »).",
  },
]

const CLOSING_FIELDS: PaperFormField[] = [
  {
    key: "droit_image", label: "Droit à l'image & RGPD", page: 2, target: "imageRights",
    hint: "true si l'autorisation est cochée ; false si le refus est coché ou si la case est vide.",
  },
  {
    key: "date_signature", label: "Fait à Séné, le", page: 2, target: "notes",
    hint: "La date écrite après « Fait à Séné, le », recopiée telle quelle. La signature n'est pas à lire.",
  },
]

const ENGAGEMENT_NOTES_HINT = "Case à cocher : réponds « Oui » si elle est cochée, « Non » si elle est vide."

// legalDocumentIds: the AssociationDocument each commitment maps to, when the association
// has one. A commitment without a document is still read, into the notes.
export function buildDacAcademyTemplateFields(
  legalDocumentIds: Partial<Record<DacAcademyEngagementKey, string>>,
): PaperFormField[] {
  const engagementFields: PaperFormField[] = DAC_ACADEMY_ENGAGEMENTS.map((engagement) => {
    const legalDocumentId = legalDocumentIds[engagement.key]
    return legalDocumentId
      ? { key: engagement.key, label: engagement.label, page: 2, target: "legalDocument", legalDocumentId, hint: "Case d'acceptation, cochée ou non." }
      : { key: engagement.key, label: engagement.label, page: 2, target: "notes", hint: ENGAGEMENT_NOTES_HINT }
  })

  return [...PAGE_ONE_FIELDS, ...PAYMENT_FIELDS, ...engagementFields, ...CLOSING_FIELDS]
}

export function buildDacAcademyTemplate(legalDocumentIds: Partial<Record<DacAcademyEngagementKey, string>>) {
  return {
    name:               DAC_ACADEMY_TEMPLATE_NAME,
    pagesPerForm:       DAC_ACADEMY_PAGES_PER_FORM,
    identificationText: DAC_ACADEMY_IDENTIFICATION_TEXT,
    fields:             buildDacAcademyTemplateFields(legalDocumentIds),
  }
}
