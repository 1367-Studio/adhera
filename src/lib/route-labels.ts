import type { useTranslations } from "next-intl"

// Human labels for dashboard route segments, keyed by the segment. Shared by the header
// breadcrumbs and the help panel so a renamed module can never read differently in the two.
export function getRouteLabels(t: ReturnType<typeof useTranslations>): Record<string, string> {
  return {
    dashboard:    t("layout.appSidebar.dashboard"),
    membres:      t("layout.appSidebar.membres"),
    adhesions:    t("layout.appSidebar.adhesions"),
    evenements:   t("layout.appSidebar.evenements"),
    cotisations:  t("layout.appSidebar.cotisations"),
    actualites:   t("layout.appSidebar.actualites"),
    messages:     t("layout.appSidebar.messages"),
    materiel:     t("layout.appSidebar.materiel"),
    site:         t("layout.appSidebar.site"),
    parametres:   t("layout.appSidebar.parametres"),
    portal:       t("layout.header.myPortal"),
    profil:       t("layout.header.myProfile"),
    backoffice:   t("layout.backofficeSidebar.backoffice"),
    associations: t("layout.appSidebar.associations"),
    boutique:     t("layout.appSidebar.boutique"),
    devis:        t("layout.appSidebar.devis"),
    dons:         t("layout.appSidebar.dons"),
    factures:     t("layout.appSidebar.factures"),
    finances:     t("layout.appSidebar.finances"),
    fournisseurs: t("layout.appSidebar.fournisseurs"),
    activite:     t("layout.appSidebar.activite"),
    reunions:     t("layout.appSidebar.reunions"),
    sondages:     t("layout.appSidebar.sondages"),
    suporte:      t("layout.appSidebar.suporte"),
  }
}
