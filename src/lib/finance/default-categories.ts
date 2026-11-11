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

// Both lists are written in alphabetical order by `name`, matching the authoritative catalog
// table — purely for readability (the API's own category list is already sorted server-side,
// see api/finances/categories/route.ts's `orderBy`), not something any consumer here depends on.
export const DEFAULT_FINANCE_CATEGORIES: DefaultFinanceCategory[] = [
  // Receitas / Produits d'exploitation
  { key: "autresRecettes",              name: "Autres recettes",               type: "INCOME", accountingCode: "758000",
    description: "Autres recettes de gestion courante ne correspondant à aucune catégorie proposée.", section: section("758000") },
  // "Billetterie" gets Formwise's own suggested subaccount (706100) as its primary pick, with
  // the broader 706000 offered as the explicit alternative — see chart-of-accounts.ts's doc
  // comment on why these two stay separate from each other and from "factures" below.
  { key: "evenements",                  name: "Billetterie",                   type: "INCOME", accountingCode: "706100",
    description: "Recettes provenant des ventes de billets et des inscriptions payantes aux événements.", alternativeAccountingCodes: ["706000"], section: section("706100") },
  { key: "boutique",                    name: "Boutique",                      type: "INCOME", accountingCode: "707000",
    description: "Ventes d'articles achetés pour être revendus : vêtements, accessoires, livres ou autres produits.", section: section("707000") },
  { key: "cotisationsAvecContrepartie", name: "Cotisations avec contrepartie",  type: "INCOME", accountingCode: "756200",
    description: "Adhésions donnant accès à des activités, des services ou des avantages significatifs.", section: section("756200") },
  { key: "cotisations",                 name: "Cotisations sans contrepartie",  type: "INCOME", accountingCode: "756100",
    description: "Adhésions qui soutiennent l'association sans donner accès à une prestation ou à un avantage significatif.", section: section("756100") },
  { key: "dons",                        name: "Dons",                           type: "INCOME", accountingCode: "754110",
    description: "Dons d'argent reçus pour soutenir l'association, sans contrepartie équivalente pour le donateur.", section: section("754110") },
  { key: "mecenat",                     name: "Mécénat",                        type: "INCOME", accountingCode: "754200",
    description: "Soutiens financiers reçus dans le cadre d'un mécénat, sans prestation publicitaire équivalente en échange.", section: section("754200") },
  { key: "patronageAvecContrepartie",   name: "Parrainage publicitaire",        type: "INCOME", accountingCode: "706300",
    description: "Sommes reçues en échange d'une prestation publicitaire : logo, visibilité ou promotion d'un partenaire.", section: section("706300") },
  // Generic bucket for a Facture payment with no more specific signal — a Facture carries no
  // type/nature field to classify by (unlike Cotisation/Don/Commande/Participation, which all
  // have one), so every Facture not linked to a MaterialLoan (which keeps its material's own
  // category — see recordCotisationPayment's sibling in factures/[id]/paiements/route.ts) falls
  // here via the "factures" origin key in category-resolution.ts. Distinct from "evenements" —
  // same 706 account family, different subaccount (706000 vs 706100).
  { key: "factures",                    name: "Prestations facturées",          type: "INCOME", accountingCode: "706000",
    description: "Cours, ateliers, interventions et autres services facturés en dehors des cotisations et de la billetterie.", section: section("706000") },
  { key: "subventions",                 name: "Subventions de fonctionnement",  type: "INCOME", accountingCode: "741000",
    description: "Aides attribuées pour financer le fonctionnement ou les actions courantes de l'association.", section: section("741000") },

  // Despesas / Charges d'exploitation
  { key: "abonnementFormwise",    name: "Abonnement Formwise",               type: "EXPENSE", accountingCode: "651100",
    description: "Abonnement mensuel ou annuel payé pour utiliser Formwise.", section: section("651100") },
  { key: "achatsMarchandises",    name: "Achats pour la boutique",           type: "EXPENSE", accountingCode: "607000",
    description: "Achats d'articles destinés à être revendus dans la boutique ou lors des événements.", section: section("607000") },
  { key: "alimentationActivites", name: "Alimentation pour les activités",   type: "EXPENSE", accountingCode: "606800",
    description: "Nourriture et boissons achetées pour les activités, sans être destinées à la revente.", section: section("606800") },
  { key: "assurance",             name: "Assurance",                         type: "EXPENSE", accountingCode: "616000",
    description: "Assurances des activités, des locaux, du matériel et de la responsabilité de l'association.", section: section("616000") },
  { key: "autresDepenses",        name: "Autres dépenses",                   type: "EXPENSE", accountingCode: "658000",
    description: "Autres charges de gestion courante ne correspondant à aucune catégorie proposée.", section: section("658000") },
  { key: "chargesSociales",       name: "Charges sociales",                  type: "EXPENSE", accountingCode: "645000",
    description: "Cotisations sociales patronales liées aux salariés de l'association.", section: section("645000") },
  // 622200, NOT 622600 (Honoraires) — see chart-of-accounts.ts's doc comment, this used to be
  // mis-coded onto the Honoraires account before this fix.
  { key: "commissionFormwise",    name: "Commission Formwise",               type: "EXPENSE", accountingCode: "622200",
    description: "Commissions variables facturées par Formwise sur les opérations, hors abonnement et frais Stripe.", section: section("622200") },
  { key: "communication",         name: "Communication",                     type: "EXPENSE", accountingCode: "623000",
    description: "Affiches, flyers, annonces, campagnes publicitaires et autres supports de communication.", section: section("623000") },
  { key: "cotisationsVersees",    name: "Cotisations à d'autres organismes", type: "EXPENSE", accountingCode: "628100",
    description: "Cotisations payées à une fédération, un réseau ou un autre organisme.", section: section("628100") },
  { key: "telecom",               name: "Courrier, téléphone et Internet",   type: "EXPENSE", accountingCode: "626000",
    description: "Affranchissement, téléphone, accès Internet et frais de communication similaires.", section: section("626000") },
  { key: "transport",             name: "Déplacements",                      type: "EXPENSE", accountingCode: "625100",
    description: "Trajets réalisés pour l'association : train, déplacements kilométriques, péages et stationnement.", section: section("625100") },
  { key: "eauEnergie",            name: "Eau et énergie",                    type: "EXPENSE", accountingCode: "606100",
    description: "Factures d'eau, d'électricité, de gaz et autres fournitures d'énergie.", section: section("606100") },
  { key: "materielEntretien",     name: "Entretien et petit équipement",     type: "EXPENSE", accountingCode: "606300",
    description: "Produits d'entretien, petits outils et équipements pouvant être comptabilisés directement en charges.", section: section("606300") },
  { key: "maintenance",           name: "Entretien et réparations",          type: "EXPENSE", accountingCode: "615000",
    description: "Prestations d'entretien et de réparation des locaux ou du matériel.", section: section("615000") },
  { key: "fournituresAdmin",      name: "Fournitures administratives",       type: "EXPENSE", accountingCode: "606400",
    description: "Papier, stylos, enveloppes, cartouches d'encre et autres fournitures de bureau.", section: section("606400") },
  // "fraisBancaires" is reserved for genuine bank charges; "fraisStripe" tracks Stripe's own
  // per-charge processing fee separately — same account (627000), independent category/key, so
  // the two stay distinguishable in reports even though they share one PCG line.
  { key: "fraisBancaires",        name: "Frais bancaires",                   type: "EXPENSE", accountingCode: "627000",
    description: "Frais de tenue de compte et de services bancaires, hors frais Stripe et intérêts d'emprunt.", section: section("627000") },
  { key: "fraisStripe",           name: "Frais Stripe",                      type: "EXPENSE", accountingCode: "627000",
    description: "Frais de traitement des paiements et autres frais facturés par Stripe.", section: section("627000") },
  { key: "honoraires",            name: "Honoraires",                        type: "EXPENSE", accountingCode: "622600",
    description: "Prestations d'expert-comptable, d'avocat, de conseil et autres professionnels rémunérés en honoraires.", section: section("622600") },
  { key: "location",              name: "Location de locaux",                type: "EXPENSE", accountingCode: "613200",
    description: "Location de bureaux, salles, terrains ou autres locaux utilisés par l'association.", section: section("613200") },
  { key: "locationMateriel",      name: "Location de matériel",              type: "EXPENSE", accountingCode: "613500",
    description: "Location de matériel, de véhicules ou d'équipements pour les activités de l'association.", section: section("613500") },
  // Shares its account (651100) with "abonnementFormwise" above — a treasurer's other software
  // subscriptions (not Formwise itself), tracked as its own category/key for separate reporting.
  { key: "logicielsEnLigne",      name: "Logiciels et services en ligne",    type: "EXPENSE", accountingCode: "651100",
    description: "Abonnements donnant accès à des logiciels ou solutions informatiques, hors abonnement Formwise.", section: section("651100") },
  { key: "missionsHebergement",   name: "Missions et hébergement",           type: "EXPENSE", accountingCode: "625600",
    description: "Hébergement et repas engagés pendant une mission ou un déplacement pour l'association.", section: section("625600") },
  { key: "receptionsConvivialite", name: "Réceptions et convivialité",       type: "EXPENSE", accountingCode: "625700",
    description: "Repas, accueils et réceptions organisés dans le cadre de la vie associative.", section: section("625700") },
  { key: "salaires",               name: "Salaires",                         type: "EXPENSE", accountingCode: "641000",
    description: "Rémunérations brutes des salariés, hors cotisations sociales patronales.", section: section("641000") },
  { key: "servicesExterieurs",     name: "Services intégrés aux prestations", type: "EXPENSE", accountingCode: "604000",
    description: "Études et prestations de services intégrées à l'activité de l'association.", section: section("604000") },
  { key: "sousTraitance",          name: "Sous-traitance",                   type: "EXPENSE", accountingCode: "611000",
    description: "Missions ou travaux confiés à un prestataire extérieur, hors dépenses relevant d'une catégorie plus précise.", section: section("611000") },
  { key: "transportMarchandises",  name: "Transport de marchandises",        type: "EXPENSE", accountingCode: "624000",
    description: "Frais de transport ou d'expédition des marchandises et du matériel.", section: section("624000") },

  // Imobilizado (218300/681000) is deliberately NOT offered here — a capital-asset purchase or
  // depreciation entry needs specific accounting treatment, not the routine current-use picker
  // (CategoryTemplatePicker) or auto-seed (ensureDefaultFinanceCategories) every other entry in
  // this array feeds. A treasurer who genuinely needs one still can, via "Catégorie
  // personnalisée", which offers the full REFERENCE_ACCOUNTS list including those two codes.
]

export function defaultCategoryByKey(key: string): DefaultFinanceCategory | undefined {
  return DEFAULT_FINANCE_CATEGORIES.find(c => c.key === key)
}

// Accent/case-insensitive substring match against the catalog's display names, scoped to one
// type (income/expense never cross-suggest) — backs the "Éditer/Nouvelle catégorie" name field's
// autocomplete. Mirrors the accent-stripping in src/lib/membre-import-matching.ts's normalizeName.
// Below the 3-letter threshold, the caller shouldn't even show a dropdown — returning [] here
// keeps that one rule in a single place instead of every call site re-checking the length itself.
function normalizeForSearch(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
}

export function searchDefaultCategories(type: FinanceCategoryType, query: string): DefaultFinanceCategory[] {
  const normalizedQuery = normalizeForSearch(query)
  if (normalizedQuery.length < 3) return []
  return DEFAULT_FINANCE_CATEGORIES.filter(c => c.type === type && normalizeForSearch(c.name).includes(normalizedQuery))
}
