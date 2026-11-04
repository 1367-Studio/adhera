import type { Metadata } from "next"
import { MembreDuplicateMergeView } from "@/components/membres/membre-duplicate-merge-view"

export const metadata: Metadata = { title: "Comparer et fusionner" }

export default async function MembreDuplicateMergePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <MembreDuplicateMergeView apiBasePath="/api/membres/duplicates" matchId={id} backHref="/dashboard/membres/duplicates" />
}
