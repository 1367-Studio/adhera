// Valeurs de filtrage partagées entre l'accueil et la liste des cotisations.
//
// Volontairement dans son propre fichier, sans aucun import : cotisation-status.ts dépend de
// cotisation-payments.ts, qui importe Prisma — y placer cette constante entraînait `pg` dans
// le bundle navigateur dès qu'un composant client la lisait, et cassait le build.

// Les trois statuts qui représentent de l'argent encore attendu. Sérialisé en une seule valeur
// pour servir à la fois de paramètre d'URL et de valeur du menu déroulant : GET
// /api/cotisations accepte une liste séparée par des virgules.
export const PENDING_COTISATION_STATUSES = "EN_ATTENTE,PARTIELLEMENT_PAYEE,EN_RETARD"

// Sentinel for the Cotisations page's "Catégorie" filter — picks rows whose tierId is null
// (manual/legacy cotisations never linked to a MembershipTier) rather than "no filter". Real
// data has these (e.g. admin-created rows, or ones from a since-deleted tier via SetNull), and
// "Voir la répartition" already surfaces them as their own "Sans catégorie" group — this is
// what lets the main table/indicators/export be narrowed down to just that group too.
export const NO_CATEGORY_FILTER = "__none__"
