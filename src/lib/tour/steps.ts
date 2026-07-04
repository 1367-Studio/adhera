// Definitions for the guided product tour (driver.js).
// Each step targets an element by CSS selector. Steps whose element is not in
// the DOM (feature disabled or hidden by role/module) are skipped at runtime,
// so the same list works for every role and module configuration.

export interface TourStepDef {
  /** CSS selector of the target element. Empty string = centered popover (no target). */
  selector: string
  title:    string
  description: string
  side?:  "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
}

/** Main dashboard walkthrough — explains each feature and how to get started. */
export const dashboardTour: TourStepDef[] = [
  {
    selector: "",
    title: "Bienvenue sur Adhéra 👋",
    description:
      "Faisons un tour rapide de votre espace de gestion. Vous découvrirez à quoi sert chaque section et comment démarrer. Vous pourrez relancer cette visite à tout moment avec le bouton d'aide en haut à droite.",
  },
  {
    selector: '[data-tour="nav-dashboard"]',
    title: "Tableau de bord",
    description:
      "Votre point de départ : chiffres clés, prochains événements et activité récente de l'association en un coup d'œil.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-membres"]',
    title: "Membres",
    description:
      "Le cœur de votre association. Ajoutez un membre avec le bouton « Ajouter » en haut de la page, importez une liste, filtrez par statut ou type, et envoyez des SMS en nombre.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-evenements"]',
    title: "Événements",
    description:
      "Créez un événement (assemblée, sortie, atelier…) avec « Nouvel événement ». Gérez les inscriptions (RSVP), le lieu sur la carte, et vendez des billets payants via Stripe.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-cotisations"]',
    title: "Cotisations",
    description:
      "Suivez les cotisations annuelles de chaque membre : qui a payé, qui reste à relancer. Définissez le montant et exportez le suivi quand vous le souhaitez.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-tresorerie"]',
    title: "Trésorerie",
    description:
      "Enregistrez recettes et dépenses par catégorie pour suivre le solde de l'association. Ajoutez une opération avec le bouton dédié en haut de la page.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-dons"]',
    title: "Dons",
    description:
      "Collectez et suivez les dons faits à votre association, avec le détail par donateur.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-reunions"]',
    title: "Réunions",
    description:
      "Organisez des réunions en visioconférence directement dans Adhéra. Créez une réunion et partagez le lien avec les participants.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-sondages"]',
    title: "Sondages",
    description:
      "Consultez vos membres : créez un sondage, ajoutez vos questions et suivez les réponses en temps réel.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-boutique"]',
    title: "Boutique",
    description:
      "Vendez des produits ou goodies à vos membres. Ajoutez un article, fixez son prix et gérez les commandes.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-actualites"]',
    title: "Actualités",
    description:
      "Publiez des articles avec texte enrichi et images. Choisissez les destinataires : une notification en temps réel les prévient automatiquement.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-messages"]',
    title: "Messages",
    description:
      "Échangez avec vos membres depuis un espace de messagerie centralisé.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-materiel"]',
    title: "Matériel",
    description:
      "Inventoriez le matériel de l'association et suivez les prêts et emprunts.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-site"]',
    title: "Site web",
    description:
      "Personnalisez la page publique de votre association : bannière, événements, actualités, formulaire d'adhésion et contact. Chaque section est modulable.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-activite"]',
    title: "Historique",
    description:
      "Retrouvez le journal des actions réalisées dans l'espace de gestion pour garder une trace de ce qui a changé.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="nav-parametres"]',
    title: "Paramètres",
    description:
      "Configurez votre association et activez ou désactivez chaque module. Un module désactivé disparaît du menu, mais vos données sont conservées.",
    side: "right",
    align: "start",
  },
  {
    selector: '[data-tour="view-switcher"]',
    title: "Basculer d'espace",
    description:
      "Passez de l'espace de gestion à « Mon espace », la vue membre du portail, pour voir ce que vos adhérents voient.",
    side: "bottom",
    align: "end",
  },
  {
    selector: '[data-tour="notifications"]',
    title: "Notifications",
    description:
      "Vos alertes en temps réel apparaissent ici : nouvelles inscriptions, réponses, paiements…",
    side: "bottom",
    align: "end",
  },
  {
    selector: '[data-tour="theme-toggle"]',
    title: "Thème clair / sombre",
    description: "Basculez entre le mode clair et le mode sombre selon votre préférence.",
    side: "bottom",
    align: "end",
  },
  {
    selector: '[data-tour="user-menu"]',
    title: "Votre profil",
    description:
      "Modifiez votre profil, changez votre mot de passe et déconnectez-vous depuis ce menu.",
    side: "bottom",
    align: "end",
  },
  {
    selector: '[data-tour="help"]',
    title: "Besoin d'aide ?",
    description:
      "C'est fini ! Un oubli ou une question plus tard ? Cliquez sur ce bouton pour relancer la visite quand vous voulez.",
    side: "bottom",
    align: "end",
  },
]
