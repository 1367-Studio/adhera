import { SparklesIcon } from "@sanity/icons/Sparkles"
import { defineArrayMember, defineField, defineType } from "sanity"

import { HELP_MODULES } from "../shared/help-modules"
import { pickDefaultLanguageValue } from "../shared/localized-value"

export const CHANGELOG_KINDS = [
  { value: "feature", title: "Nouvelle fonctionnalité" },
  { value: "improvement", title: "Amélioration" },
  { value: "fix", title: "Correction" },
]

export const changelogEntry = defineType({
  name: "changelogEntry",
  title: "Nouveauté",
  type: "document",
  icon: SparklesIcon,
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
      name: "kind",
      title: "Type",
      type: "string",
      options: { list: CHANGELOG_KINDS, layout: "radio", direction: "horizontal" },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "modules",
      title: "Modules concernés",
      type: "array",
      of: [defineArrayMember({ type: "string" })],
      options: { list: HELP_MODULES },
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
    select: { title: "title", publishedAt: "publishedAt", kind: "kind" },
    prepare({ title, publishedAt, kind }) {
      const kindTitle = CHANGELOG_KINDS.find((changelogKind) => changelogKind.value === kind)?.title
      return {
        title: pickDefaultLanguageValue<string>(title) ?? "Sans titre",
        subtitle: [publishedAt, kindTitle].filter(Boolean).join(" · "),
      }
    },
  },
})
