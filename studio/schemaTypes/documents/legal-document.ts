import { DocumentsIcon } from "@sanity/icons/Documents"
import { defineField, defineType } from "sanity"

import { pickDefaultLanguageValue } from "../shared/localized-value"

export const LEGAL_DOCUMENT_KINDS = [
  { value: "cgu", title: "Conditions générales d'utilisation (CGU)" },
  { value: "cgs", title: "Conditions générales de service (CGS)" },
  { value: "mentions-legales", title: "Mentions légales" },
  { value: "politique-confidentialite", title: "Politique de confidentialité" },
]

export const legalDocument = defineType({
  name: "legalDocument",
  title: "Document légal",
  type: "document",
  icon: DocumentsIcon,
  fields: [
    defineField({
      name: "kind",
      title: "Type de document",
      type: "string",
      options: { list: LEGAL_DOCUMENT_KINDS, layout: "radio" },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "version",
      title: "Version",
      type: "string",
      description: "Par exemple « 2026-09 ».",
    }),
    defineField({
      name: "effectiveAt",
      title: "Date d'entrée en vigueur",
      type: "date",
    }),
    defineField({
      name: "title",
      title: "Titre",
      type: "internationalizedArrayString",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "body",
      title: "Contenu",
      type: "internationalizedArrayHelpBody",
      validation: (rule) => rule.required(),
    }),
  ],
  preview: {
    select: { title: "title", kind: "kind", version: "version" },
    prepare({ title, kind, version }) {
      const kindTitle = LEGAL_DOCUMENT_KINDS.find((legalKind) => legalKind.value === kind)?.title
      return {
        title: pickDefaultLanguageValue<string>(title) ?? kindTitle ?? "Sans titre",
        subtitle: [kindTitle, version].filter(Boolean).join(" · "),
      }
    },
  },
})
