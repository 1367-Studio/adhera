import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod"
import { z } from "zod"
import { retrieveHelpContext } from "@/lib/help/retrieval"
import { runToolSafely } from "@/lib/assistant/tool-result"
import type { ToolContext } from "@/lib/assistant/types"

const TOOL_NAME  = "search_help_docs"
const HITS_LIMIT = 5

// Always available, whatever the role: the help documentation is not association data.
export function searchHelpDocsTool(context: ToolContext) {
  return betaZodTool({
    name:        TOOL_NAME,
    description:
      "Recherche dans la documentation d'aide de Formwise. Appelle cet outil dès que la question porte sur l'utilisation du logiciel : " +
      "comment faire quelque chose, où se trouve une fonctionnalité, à quoi sert un écran, comment configurer un module. " +
      "Renvoie jusqu'à 5 passages (titre, slug, texte) ; réponds uniquement à partir de ces passages.",
    inputSchema: z.object({
      query: z.string().trim().min(2).max(300).describe("Question ou mots-clés à rechercher dans la documentation, dans la langue de l'utilisateur"),
    }),
    run: (input) => runToolSafely(TOOL_NAME, async () => {
      const hits = await retrieveHelpContext({ question: input.query, locale: context.locale, limit: HITS_LIMIT })
      context.collectedHelpHits.push(...hits)
      return {
        hits: hits.map((hit) => ({ title: hit.title, slug: hit.slug, text: hit.text })),
      }
    }),
  })
}
