import { BookIcon } from "@sanity/icons/Book"
import { FolderIcon } from "@sanity/icons/Folder"
import type { StructureResolver } from "sanity/structure"

import { HELP_MODULES } from "./schemaTypes/shared/help-modules"

const SANITY_API_VERSION = "2026-09-11"

export const HELP_ARTICLE_BY_MODULE_TEMPLATE_ID = "helpArticle-by-module"

export const structure: StructureResolver = (structureBuilder) =>
  structureBuilder.list()
    .title("Contenu")
    .items([
      structureBuilder.listItem()
        .title("Aide")
        .id("aide")
        .icon(BookIcon)
        .child(
          structureBuilder.list()
            .title("Aide")
            .items([
              ...HELP_MODULES.map((helpModule) =>
                structureBuilder.listItem()
                  .title(helpModule.title)
                  .id(`aide-${helpModule.value}`)
                  .icon(FolderIcon)
                  .child(
                    structureBuilder.documentTypeList("helpArticle")
                      .title(helpModule.title)
                      .apiVersion(SANITY_API_VERSION)
                      .filter('_type == "helpArticle" && module == $module')
                      .params({ module: helpModule.value })
                      .initialValueTemplates([
                        structureBuilder.initialValueTemplateItem(HELP_ARTICLE_BY_MODULE_TEMPLATE_ID, {
                          module: helpModule.value,
                        }),
                      ]),
                  ),
              ),
              structureBuilder.divider(),
              structureBuilder.documentTypeListItem("helpArticle").title("Tous les articles"),
            ]),
        ),
      structureBuilder.divider(),
      structureBuilder.documentTypeListItem("faqEntry").title("FAQ"),
      structureBuilder.documentTypeListItem("changelogEntry").title("Nouveautés"),
      structureBuilder.documentTypeListItem("legalDocument").title("Documents légaux"),
    ])
