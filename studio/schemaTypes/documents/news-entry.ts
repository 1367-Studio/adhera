import { BellIcon } from "@sanity/icons/Bell"
import { defineField, defineType } from "sanity"

import { pickDefaultLanguageValue } from "../shared/localized-value"
import { createPopupCapWarning } from "../shared/popup-cap-validation"

export const newsEntry = defineType({
  name: "newsEntry",
  title: "Actualité",
  type: "document",
  icon: BellIcon,
  fields: [
    defineField({
      name: "title",
      title: "Titre",
      type: "internationalizedArrayString",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "publishedAt",
      title: "Date de publication",
      type: "date",
      initialValue: () => new Date().toISOString().slice(0, 10),
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "pinned",
      title: "Épinglé",
      type: "boolean",
      description: "Affiché en tête de l'onglet Actualités du centre d'aide, avec le badge « Nouveau ».",
      initialValue: false,
    }),
    defineField({
      name: "showInPopup",
      title: "Afficher dans une pop-up",
      description:
        "S'affiche une fois dans une pop-up à l'ouverture de l'application, pour les utilisateurs qui ne l'ont pas encore vue. Désactivé par défaut : il faut cocher explicitement cette case pour déclencher la pop-up.",
      type: "boolean",
      initialValue: false,
      validation: (rule) => rule.custom(createPopupCapWarning("newsEntry")).warning(),
    }),
    defineField({
      name: "image",
      title: "Image (pop-up)",
      description: "Capture d'écran ou illustration au format 16:9, 1280×720 minimum. Affichée en tête de l'actualité dans la pop-up.",
      type: "image",
      options: { hotspot: true },
      fields: [
        defineField({
          name: "alt",
          title: "Texte alternatif",
          type: "string",
          // Only required once an image is actually set — the image itself stays optional.
          validation: (rule) =>
            rule.custom((altText, context) => {
              const parentImage = context.parent as { asset?: unknown } | undefined
              if (!parentImage?.asset) return true
              return altText?.trim() ? true : "Le texte alternatif est requis lorsqu'une image est ajoutée."
            }),
        }),
      ],
    }),
    defineField({
      name: "body",
      title: "Contenu",
      type: "internationalizedArrayHelpBody",
    }),
  ],
  orderings: [
    { title: "Date de publication", name: "publishedAtDesc", by: [{ field: "publishedAt", direction: "desc" }] },
  ],
  preview: {
    select: { title: "title", publishedAt: "publishedAt", pinned: "pinned" },
    prepare({ title, publishedAt, pinned }) {
      return {
        title: pickDefaultLanguageValue<string>(title) ?? "Sans titre",
        subtitle: [pinned ? "Épinglé" : null, publishedAt].filter(Boolean).join(" · "),
      }
    },
  },
})
