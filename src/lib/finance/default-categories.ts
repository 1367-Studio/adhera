// src/lib/finance/default-categories.ts
// Single source of truth for the system/default FinanceCategory rows — one list consumed by
// the seed route (api/finances/categories/seed) to create them, and by the Compte de résultat
// calculation (src/lib/finance/income-statement.ts) as a hardcoded fallback when a given
// association deleted its own copy of a default category (the report must never break just
// because a key category went missing).
//
// accountingCode values are drawn from the controlled reference list in chart-of-accounts.ts
// (French PCG adapted for associations — www.anc.gouv.fr); every FinanceCategory, default or
// custom, must point at one of those codes (see financeCategorySchema). `key` is the stable
// identifier the report's buckets resolve against; it is never shown to the end user, only
// used internally and in exports. Renaming a `name` here is free (existing rows keep their own
// name until re-seeded/edited); renaming or removing a `key` is NOT — it's the id
// getOrCreateDefaultCategory/resolveIncomeCategory look rows up by, so every key below is
// permanent once shipped.
// Pure data — no `prisma` import here on purpose. This file is imported directly from client
// components too (e.g. category-template-picker.tsx); `prisma` pulls in the `pg` driver (needs
// Node's `dns` module) and would break any client bundle that transitively imports it. The
// server-only find-or-create helper lives in ensure-default-categories.ts instead.
import type { FinanceCategoryType, FinanceSection } from "@prisma/client"
import { sectionForAccountCode } from "@/lib/finance/chart-of-accounts"

export interface DefaultFinanceCategory {
  key:            string
  name:           string
  type:           FinanceCategoryType
  accountingCode: string
  description:    string
  section:        FinanceSection
  // A second account the create-flow UI offers alongside the primary one, for categories where
  // a real alternative exists (see FORM-category-template-picker). Everything else still gets
  // "voir les autres comptes" (the full reference list for that type), it just doesn't get a
  // second pre-highlighted suggestion.
  alternativeAccountingCodes?: string[]
}

// section is derived from accountingCode (single source of truth: chart-of-accounts.ts) rather
// than hardcoded per entry — the two used to be able to drift out of sync (e.g. a default
// category pointing at an account the reference list considered a different section).
//
// Falls back to "OTHER" + a logged error instead of throwing: this runs at MODULE LOAD time (it
// builds DEFAULT_FINANCE_CATEGORIES itself), so throwing here would take down every consumer —
// seeding, the Compte de résultat report, the category template picker — for every association,
// the instant a single entry's accountingCode has a typo. A wrong-but-present section is a
// narrow, visible (via the error log, and via "Section à vérifier" never matching what's
// expected) data bug confined to that one category; a thrown exception here is a platform-wide
// outage. Still logs loudly so the typo doesn't go unnoticed.
function section(accountingCode: string): FinanceSection {
  const resolved = sectionForAccountCode(accountingCode)
  if (!resolved) {
    console.error(`default-categories.ts: "${accountingCode}" is not in chart-of-accounts.ts — falling back to OTHER`)
    return "OTHER"
  }
  return resolved
}

export const DEFAULT_FINANCE_CATEGORIES: DefaultFinanceCategory[] = [
  // Receitas / Produits d'exploitation
  { key: "cotisations",                 name: "Cotisations sans contrepartie", type: "INCOME", accountingCode: "756100",
    description: "Cotisations des membres sans contrepartie directe (adhésion simple).", section: section("756100") },
  { key: "cotisationsAvecContrepartie",  name: "Cotisations avec contrepartie", type: "INCOME", accountingCode: "756200",
    description: "Cotisations donnant droit à une contrepartie (accès à des services ou activités).", section: section("756200") },
  { key: "dons",                         name: "Dons",                          type: "INCOME", accountingCode: "754110",
    description: "Dons manuels reçus de particuliers ou d'entreprises.", section: section("754110") },
  { key: "mecenat",                      name: "Mécénat",                       type: "INCOME", accountingCode: "754200",
    description: "Soutien financier d'une entreprise dans une démarche de mécénat.", section: section("754200") },
  { key: "patronageAvecContrepartie",    name: "Parrainage publicitaire",       type: "INCOME", accountingCode: "706300",
    description: "Parrainage avec contrepartie publicitaire (logo, visibilité).", section: section("706300") },
  // "Billetterie" gets Formwise's own suggested subaccount (706100) as its primary pick, with
  // the broader 706000 offered as the explicit alternative — see chart-of-accounts.ts's doc
  // comment on why these two stay separate from each other and from "factures" below.
  { key: "evenements",                   name: "Billetterie",                   type: "INCOME", accountingCode: "706100",
    description: "Vente de places pour une activité ou un événement.", alternativeAccountingCodes: ["706000"], section: section("706100") },
  { key: "boutique",                     name: "Boutique",                      type: "INCOME", accountingCode: "707000",
    description: "Vente de produits de la boutique de l'association.", section: section("707000") },
  { key: "subventions",                  name: "Subventions d'exploitation",    type: "INCOME", accountingCode: "741000",
    description: "Subventions reçues pour le fonctionnement courant de l'association.", section: section("741000") },
  { key: "autresRecettes",               name: "Autres recettes courantes",     type: "INCOME", accountingCode: "758000",
    description: "Autres produits de gestion courante non couverts par les catégories ci-dessus.", section: section("758000") },
  // Generic bucket for a Facture payment with no more specific signal — a Facture carries no
  // type/nature field to classify by (unlike Cotisation/Don/Commande/Participation, which all
  // have one), so every Facture not linked to a MaterialLoan (which keeps its material's own
  // category — see recordCotisationPayment's sibling in factures/[id]/paiements/route.ts) falls
  // here via the "factures" origin key in category-resolution.ts. Distinct from "evenements" —
  // same 706 account family, different subaccount (706000 vs 706100).
  { key: "factures",                     name: "Prestations facturées",         type: "INCOME", accountingCode: "706000",
    description: "Prestations de services facturées sans catégorie plus spécifique.", section: section("706000") },

  // Despesas / Charges d'exploitation
  { key: "abonnementFormwise", name: "Abonnement Formwise",              type: "EXPENSE", accountingCode: "651100",
    description: "Abonnement mensuel ou annuel pour l'utilisation du logiciel Formwise.", section: section("651100") },
  { key: "achatsMarchandises", name: "Achats pour revente",              type: "EXPENSE", accountingCode: "607000",
    description: "Marchandises achetées pour être revendues sans transformation.", section: section("607000") },
  { key: "alimentationActivites", name: "Alimentation pour les activités", type: "EXPENSE", accountingCode: "606800",
    description: "Achats alimentaires non stockés consommés lors des activités (hors revente).", section: section("606800") },
  { key: "assurance",          name: "Assurance",                        type: "EXPENSE", accountingCode: "616000",
    description: "Primes d'assurance de l'association.", section: section("616000") },
  { key: "autresDepenses",     name: "Autres charges courantes",         type: "EXPENSE", accountingCode: "658000",
    description: "Autres charges de gestion courante non couvertes par les catégories ci-dessus.", section: section("658000") },
  { key: "chargesSociales",    name: "Charges sociales",                 type: "EXPENSE", accountingCode: "645000",
    description: "Cotisations de sécurité sociale et de prévoyance liées aux salaires.", section: section("645000") },
  // 622200, NOT 622600 (Honoraires) — see chart-of-accounts.ts's doc comment, this used to be
  // mis-coded onto the Honoraires account before this fix.
  { key: "commissionFormwise", name: "Commission Formwise",              type: "EXPENSE", accountingCode: "622200",
    description: "Commission Formwise sur les ventes ou paiements correspondants.", section: section("622200") },
  { key: "communication",      name: "Communication",                    type: "EXPENSE", accountingCode: "623000",
    description: "Publicité, publications et relations publiques.", section: section("623000") },
  { key: "cotisationsVersees", name: "Cotisations à d'autres organismes", type: "EXPENSE", accountingCode: "628100",
    description: "Cotisations versées par l'association à d'autres organismes.", section: section("628100") },
  { key: "telecom",            name: "Courrier, téléphone et internet",  type: "EXPENSE", accountingCode: "626000",
    description: "Frais postaux et de télécommunications.", section: section("626000") },
  { key: "transport",          name: "Déplacements",                     type: "EXPENSE", accountingCode: "625100",
    description: "Frais de voyages et de déplacements.", section: section("625100") },
  { key: "eauEnergie",         name: "Eau et énergie",                   type: "EXPENSE", accountingCode: "606100",
    description: "Fournitures non stockables : eau, énergie, etc.", section: section("606100") },
  { key: "materielEntretien",  name: "Entretien et petit équipement",    type: "EXPENSE", accountingCode: "606300",
    description: "Fournitures d'entretien et petit équipement.", section: section("606300") },
  { key: "maintenance",        name: "Entretien et réparations",         type: "EXPENSE", accountingCode: "615000",
    description: "Entretien et réparation des biens de l'association.", section: section("615000") },
  { key: "fournituresAdmin",   name: "Fournitures administratives",      type: "EXPENSE", accountingCode: "606400",
    description: "Fournitures de bureau et administratives.", section: section("606400") },
  // "fraisBancaires" is now reserved for genuine bank charges — Stripe's own per-charge
  // processing fee has its own category below (see connect-stripe-fee.ts, which used to book
  // it here before this fix).
  { key: "fraisBancaires",     name: "Frais bancaires",                  type: "EXPENSE", accountingCode: "627000",
    description: "Services bancaires et assimilés, hors frais de traitement Stripe.", section: section("627000") },
  { key: "fraisStripe",        name: "Frais Stripe",                     type: "EXPENSE", accountingCode: "627800",
    description: "Frais de traitement des paiements prélevés par Stripe.", section: section("627800") },
  { key: "honoraires",         name: "Honoraires",                       type: "EXPENSE", accountingCode: "622600",
    description: "Honoraires versés à des prestataires externes (comptable, avocat...).", section: section("622600") },
  { key: "location",           name: "Location de locaux et de salles",  type: "EXPENSE", accountingCode: "613200",
    description: "Location de salles ou de locaux pour les activités de l'association.", section: section("613200") },
  { key: "locationMateriel",   name: "Location de matériel",             type: "EXPENSE", accountingCode: "613500",
    description: "Location de matériel pour les activités de l'association.", section: section("613500") },
  { key: "salaires",           name: "Salaires",                         type: "EXPENSE", accountingCode: "641000",
    description: "Rémunérations du personnel salarié.", section: section("641000") },
  { key: "servicesExterieurs", name: "Services intégrés aux prestations", type: "EXPENSE", accountingCode: "604000",
    description: "Études et prestations de services intégrées à l'activité de l'association.", section: section("604000") },
  { key: "sousTraitance",      name: "Sous-traitance générale",          type: "EXPENSE", accountingCode: "611000",
    description: "Travaux ou services confiés à un sous-traitant.", section: section("611000") },
  { key: "transportMarchandises", name: "Transport de marchandises",     type: "EXPENSE", accountingCode: "624000",
    description: "Transport de biens et transports collectifs du personnel.", section: section("624000") },

  // Imobilizado — informatif, hors résultat courant (voir doc comment ci-dessus)
  { key: "equipement",               name: "Matériel informatique et de bureau", type: "EXPENSE", accountingCode: "218300",
    description: "Équipement informatique ou de bureau immobilisé (hors charges courantes).", section: section("218300") },
  { key: "depreciationAmortization", name: "Dépréciations / Amortissements",     type: "EXPENSE", accountingCode: "681000",
    description: "Dépréciations et amortissements des immobilisations.", section: section("681000") },
]

export function defaultCategoryByKey(key: string): DefaultFinanceCategory | undefined {
  return DEFAULT_FINANCE_CATEGORIES.find(c => c.key === key)
}
