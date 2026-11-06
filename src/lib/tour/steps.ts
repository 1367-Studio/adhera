// Definitions for the guided product tour (driver.js).
// Each step targets an element by CSS selector. Steps whose element is not in
// the DOM (feature disabled or hidden by role/module) are skipped at runtime,
// so the same list works for every role and module configuration.

import type { useTranslations } from "next-intl"
import { APP_NAME } from "@/config/brand"

export interface TourStepDef {
  /** CSS selector of the target element. Empty string = centered popover (no target). */
  selector: string
  title:    string
  description: string
  side?:  "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
  // True for the header's utility icons (view switcher, help, notifications, theme,
  // profile) — on mobile the sidebar renders as a full-screen Sheet that covers the
  // header while open, so these steps need it closed first (see use-tour.ts).
  headerStep?: true
}

/** Main dashboard walkthrough — explains each feature and how to get started. */
export function getDashboardTour(t: ReturnType<typeof useTranslations>): TourStepDef[] {
  return [
    {
      selector: "",
      title: t("welcome.title", { appName: APP_NAME }),
      description: t("welcome.description"),
    },
    {
      selector: '[data-tour="nav-dashboard"]',
      title: t("dashboard.title"),
      description: t("dashboard.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-membres"]',
      title: t("membres.title"),
      description: t("membres.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-cotisations"]',
      title: t("cotisations.title"),
      description: t("cotisations.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-dons"]',
      title: t("dons.title"),
      description: t("dons.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-evenements"]',
      title: t("evenements.title"),
      description: t("evenements.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-messages"]',
      title: t("messages.title"),
      description: t("messages.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-reunions"]',
      title: t("reunions.title"),
      description: t("reunions.description", { appName: APP_NAME }),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-sondages"]',
      title: t("sondages.title"),
      description: t("sondages.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-actualites"]',
      title: t("actualites.title"),
      description: t("actualites.description"),
      side: "right",
      align: "start",
    },
    {
      // Targets the category trigger (single row, like every other nav step) rather
      // than the inner nav-finances wrapper, which spans the whole expanded group
      // tree (Synthèse/Transactions/Comptabilité/Rapports) and highlighted as an
      // oversized block. The trigger only renders when the association has at least
      // one enabled Finances-category item, so this stays per-association correct.
      selector: '[data-tour="nav-category-finances"]',
      title: t("finances.title"),
      description: t("finances.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-site"]',
      title: t("site.title"),
      description: t("site.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-boutique"]',
      title: t("boutique.title"),
      description: t("boutique.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-materiel"]',
      title: t("materiel.title"),
      description: t("materiel.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-activite"]',
      title: t("activite.title"),
      description: t("activite.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="nav-parametres"]',
      title: t("parametres.title"),
      description: t("parametres.description"),
      side: "right",
      align: "start",
    },
    {
      selector: '[data-tour="view-switcher"]',
      title: t("viewSwitcher.title"),
      description: t("viewSwitcher.description"),
      side: "bottom",
      align: "end",
      headerStep: true,
    },
    {
      selector: '[data-tour="help"]',
      title: t("help.title"),
      description: t("help.description"),
      side: "bottom",
      align: "end",
      headerStep: true,
    },
    {
      selector: '[data-tour="notifications"]',
      title: t("notifications.title"),
      description: t("notifications.description"),
      side: "bottom",
      align: "end",
      headerStep: true,
    },
    {
      selector: '[data-tour="theme-toggle"]',
      title: t("themeToggle.title"),
      description: t("themeToggle.description"),
      side: "bottom",
      align: "end",
      headerStep: true,
    },
    {
      selector: '[data-tour="user-menu"]',
      title: t("userMenu.title"),
      description: t("userMenu.description"),
      side: "bottom",
      align: "end",
      headerStep: true,
    },
  ]
}
