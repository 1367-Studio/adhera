import { HelpCircleIcon } from "@sanity/icons/HelpCircle"
import { defineField, defineType } from "sanity"

import { HELP_MODULES, helpModuleTitle } from "../shared/help-modules"
import { pickDefaultLanguageValue } from "../shared/localized-value"

export const faqEntry = defineType({
  name: "faqEntry",
  title: "Question fréquente",
  type: "document",
  icon: HelpCircleIcon,
  fields: [
    defineField({
      name: "question",
      title: "Question",
      type: "internationalizedArrayString",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "answer",
      title: "Réponse",
      type: "internationalizedArrayHelpBody",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "module",
      title: "Module",
      type: "string",
      description: "Laisser vide (ou choisir « Général ») pour afficher la question dans tous les modules.",
      options: { list: HELP_MODULES },
    }),
    defineField({
      name: "order",
      title: "Ordre",
      type: "number",
      description: "Tri croissant (100 par défaut).",
      initialValue: 100,
      validation: (rule) => rule.integer(),
    }),
  ],
  orderings: [
    { title: "Ordre", name: "orderAsc", by: [{ field: "order", direction: "asc" }] },
  ],
  preview: {
    select: { question: "question", module: "module" },
    prepare({ question, module }) {
      return {
        title: pickDefaultLanguageValue<string>(question) ?? "Sans question",
        subtitle: helpModuleTitle(module) ?? "Tous les modules",
      }
    },
  },
})
