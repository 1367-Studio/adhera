import { visionTool } from "@sanity/vision"
import { defineConfig } from "sanity"
import { structureTool } from "sanity/structure"
import { internationalizedArray } from "sanity-plugin-internationalized-array"

import { DEFAULT_LANGUAGE_ID, STUDIO_LANGUAGES } from "./locales"
import { schemaTypes } from "./schemaTypes"
import { HELP_ARTICLE_BY_MODULE_TEMPLATE_ID, structure } from "./structure"

const SANITY_API_VERSION = "2026-09-11"

export default defineConfig({
  name: "default",
  title: "Formwise",
  projectId: "uxyclro2",
  dataset: "production",
  plugins: [
    structureTool({ structure }),
    visionTool({ defaultApiVersion: SANITY_API_VERSION }),
    internationalizedArray({
      languages: STUDIO_LANGUAGES,
      defaultLanguages: [DEFAULT_LANGUAGE_ID],
      fieldTypes: ["string", "text", "helpBody"],
    }),
  ],
  schema: {
    types: schemaTypes,
    templates: (previousTemplates) => [
      ...previousTemplates,
      // Used by the per-module lists in the structure so a new article is created
      // with its module already set (and therefore stays visible in that list).
      {
        id: HELP_ARTICLE_BY_MODULE_TEMPLATE_ID,
        title: "Article d'aide (module pré-rempli)",
        schemaType: "helpArticle",
        parameters: [{ name: "module", type: "string", title: "Module" }],
        value: (parameters: { module: string }) => ({ module: parameters.module }),
      },
    ],
  },
})
