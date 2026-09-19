// Valeurs de filtrage partagées entre l'accueil et la liste des cotisations.
//
// Volontairement dans son propre fichier, sans aucun import : cotisation-status.ts dépend de
// cotisation-payments.ts, qui importe Prisma — y placer cette constante entraînait `pg` dans
// le bundle navigateur dès qu'un composant client la lisait, et cassait le build.

// Les trois statuts qui représentent de l'argent encore attendu. Sérialisé en une seule valeur
// pour servir à la fois de paramètre d'URL et de valeur du menu déroulant : GET
// /api/cotisations accepte une liste séparée par des virgules.
export const PENDING_COTISATION_STATUSES = "EN_ATTENTE,PARTIELLEMENT_PAYEE,EN_RETARD"
