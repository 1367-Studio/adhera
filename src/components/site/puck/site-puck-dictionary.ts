import type { Dictionary } from "@puckeditor/core"

// French strings for Puck's own editor interface (header, outline, block list, fields, rich
// text toolbar, viewports). Keys from Puck's defaultDictionary; any missing key falls back to
// Puck's English.
export const SITE_PUCK_DICTIONARY_FR: Dictionary = {
  "header-publish":              "Publier",
  "header-undo":                 "annuler",
  "header-redo":                 "rétablir",
  "header-toggle-leftsidebar":   "Afficher/masquer le panneau de gauche",
  "header-toggle-rightsidebar":  "Afficher/masquer le panneau de droite",
  "header-toggle-menubar":       "Afficher/masquer la barre de menu",

  "action-selectparent":         "Sélectionner le bloc parent",
  "action-duplicate":            "Dupliquer",
  "action-delete":               "Supprimer",

  "label-page":                  "Page",
  "label-component":             "Bloc",

  "outline-empty":               "Aucun bloc",
  "outline-item-collapse":       "Replier",
  "outline-item-expand":         "Déplier",
  "outline-header-title":        "Structure",
  "outline-header-collapseall":  "Tout replier",
  "outline-item-duplicate":      "Dupliquer",
  "outline-item-delete":         "Supprimer",

  "drawer-category-collapse":    "Replier {title}",
  "drawer-category-expand":      "Déplier {title}",
  "drawer-category-other":       "Autres",

  "canvas-noconfig":             "Aucune configuration pour {type}",

  "field-readonly":              "Lecture seule",
  "field-arrayitem-summary":     "Élément n°{index}",
  "field-arrayitem-duplicate":   "Dupliquer",
  "field-arrayitem-delete":      "Supprimer",
  "field-external-selectdata":   "Choisir",
  "field-external-search":       "Rechercher",
  "field-external-togglefilters": "Afficher/masquer les filtres",
  "field-external-item":         "Élément externe",
  "field-external-result-singular": "{count} résultat",
  "field-external-result-plural":   "{count} résultats",

  "field-richtext-bold":             "Gras",
  "field-richtext-italic":           "Italique",
  "field-richtext-underline":        "Souligné",
  "field-richtext-strikethrough":    "Barré",
  "field-richtext-blockquote":       "Citation",
  "field-richtext-code-inline":      "Code",
  "field-richtext-code-block":       "Bloc de code",
  "field-richtext-list-bullet":      "Liste à puces",
  "field-richtext-list-ordered":     "Liste numérotée",
  "field-richtext-horizontalrule":   "Séparateur",
  "field-richtext-align-left":       "Aligner à gauche",
  "field-richtext-align-center":     "Centrer",
  "field-richtext-align-right":      "Aligner à droite",
  "field-richtext-align-justify":    "Justifier",
  "field-richtext-select":           "Choisir",
  "field-richtext-headingselect-1":  "Titre 1",
  "field-richtext-headingselect-2":  "Titre 2",
  "field-richtext-headingselect-3":  "Titre 3",
  "field-richtext-headingselect-4":  "Titre 4",
  "field-richtext-headingselect-5":  "Titre 5",
  "field-richtext-headingselect-6":  "Titre 6",
  "field-richtext-alignselect-left":    "Gauche",
  "field-richtext-alignselect-center":  "Centre",
  "field-richtext-alignselect-right":   "Droite",
  "field-richtext-alignselect-justify": "Justifié",
  "field-richtext-listselect-bullet":   "Liste à puces",
  "field-richtext-listselect-ordered":  "Liste numérotée",

  "viewport-zoom-in":            "Zoomer",
  "viewport-zoom-out":           "Dézoomer",
  "viewport-zoom-auto":          "{zoom} % (auto)",
  "viewport-toggle-menu":        "Afficher/masquer le menu d'affichage",
  "viewport-switch":             "Afficher en {label}",
  "viewport-switch-default":     "Changer d'affichage",

  "plugin-blocks":               "Blocs",
  "plugin-outline":              "Structure",
  "plugin-fields":               "Réglages",
  "plugin-components":           "Blocs",

  "layout-maximize":             "agrandir",
  "layout-minimize":             "réduire",

  "loader-loading":              "chargement",
}
