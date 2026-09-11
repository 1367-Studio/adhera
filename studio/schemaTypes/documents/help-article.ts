import { DocumentTextIcon } from "@sanity/icons/DocumentText"
import { defineArrayMember, defineField, defineType } from "sanity"

import { HELP_MODULES, helpModuleTitle } from "../shared/help-modules"
import { pickDefaultLanguageValue } from "../shared/localized-value"

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function slugifyTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
}

export const helpArticle = defineType({
  name: "helpArticle",
  title: "Article d'aide",
  type: "document",
  icon: DocumentTextIcon,
  fields: [
    defineField({
      name: "title",
      title: "Titre",
      type: "internationalizedArrayString",
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      description: "Identifiant unique dans l'URL, généré à partir du titre français (minuscules et tirets).",
      options: {
        source: (document) => pickDefaultLanguageValue<string>(document.title) ?? "",
        slugify: slugifyTitle,
        maxLength: 96,
      },
      validation: (rule) =>
        rule.required().custom((slug) => {
          if (!slug?.current) return true
          return SLUG_PATTERN.test(slug.current) || "Utilisez uniquement des minuscules, chiffres et tirets."
        }),
    }),
    defineField({
      name: "module",
      title: "Module",
      type: "string",
      description: "Module du tableau de bord dans lequel l'article est proposé.",
      options: { list: HELP_MODULES },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "summary",
      title: "Résumé",
      type: "internationalizedArrayText",
      description: "Une ou deux phrases affichées dans les listes.",
    }),
    defineField({
      name: "body",
      title: "Contenu",
      type: "internationalizedArrayHelpBody",
    }),
    defineField({
      name: "keywords",
      title: "Mots-clés",
      type: "array",
      description: "Termes de recherche supplémentaires (synonymes, vocabulaire courant).",
      of: [defineArrayMember({ type: "string" })],
      options: { layout: "tags" },
    }),
    defineField({
      name: "order",
      title: "Ordre",
      type: "number",
      description: "Tri croissant à l'intérieur du module (100 par défaut).",
      initialValue: 100,
      validation: (rule) => rule.integer(),
    }),
  ],
  orderings: [
    { title: "Ordre", name: "orderAsc", by: [{ field: "order", direction: "asc" }] },
    { title: "Dernière modification", name: "updatedAtDesc", by: [{ field: "_updatedAt", direction: "desc" }] },
  ],
  preview: {
    select: { title: "title", module: "module", slug: "slug.current" },
    prepare({ title, module, slug }) {
      return {
        title: pickDefaultLanguageValue<string>(title) ?? slug ?? "Sans titre",
        subtitle: helpModuleTitle(module),
      }
    },
  },
})
