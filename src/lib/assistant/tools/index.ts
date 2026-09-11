import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool"
import { getFinanceSummaryTool } from "@/lib/assistant/tools/get-finance-summary"
import { getMemberTool } from "@/lib/assistant/tools/get-member"
import { listCotisationsTool } from "@/lib/assistant/tools/list-cotisations"
import { listDonationsTool } from "@/lib/assistant/tools/list-donations"
import { listEventsTool } from "@/lib/assistant/tools/list-events"
import { listInvoicesTool } from "@/lib/assistant/tools/list-invoices"
import { searchHelpDocsTool } from "@/lib/assistant/tools/search-help-docs"
import { searchMembersTool } from "@/lib/assistant/tools/search-members"
import type { ToolContext } from "@/lib/assistant/types"
import { isFinanceRole } from "@/lib/roles"

// The tool set is part of the cached prompt prefix, so it must be deterministic for a given
// role + module configuration: gated inclusion, then sorted by name. A tool absent here is
// simply unknown to the model — that is the whole access control for data the role must not
// see (each tool's Prisma query is additionally scoped to context.associationId). The route
// already admits staff roles only (MANAGER_ROLES), so only the finance tier is gated here.
export function buildTools(context: ToolContext): BetaRunnableTool[] {
  const isFinance = isFinanceRole(context.role)
  const { modules } = context

  const tools: BetaRunnableTool[] = [searchHelpDocsTool(context), searchMembersTool(context), getMemberTool(context)]
  if (modules.cotisations) tools.push(listCotisationsTool(context))
  if (modules.evenements)  tools.push(listEventsTool(context))
  if (modules.factures)    tools.push(listInvoicesTool(context))
  if (isFinance) {
    tools.push(getFinanceSummaryTool(context))
    if (modules.dons) tools.push(listDonationsTool(context))
  }

  return tools.sort((leftTool, rightTool) => leftTool.name.localeCompare(rightTool.name))
}
