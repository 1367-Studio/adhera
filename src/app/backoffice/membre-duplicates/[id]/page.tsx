import type { Metadata } from "next"
import { APP_NAME } from "@/config/brand"
import { MembreDuplicateMergeView } from "@/components/membres/membre-duplicate-merge-view"

export const metadata: Metadata = { title: `Comparer et fusionner — Backoffice ${APP_NAME}` }

export default async function BackofficeMembreDuplicateMergePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MembreDuplicateMergeView apiBasePath="/api/backoffice/membre-duplicates" matchId={id} backHref="/backoffice/membre-duplicates" />
}
