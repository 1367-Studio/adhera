"use client"

import { useParams } from "next/navigation"
import { ReimbursementDetail } from "@/components/reimbursements/reimbursement-detail"

export default function ReimbursementDetailPage() {
  const params = useParams<{ id: string }>()
  return <ReimbursementDetail id={params.id} />
}
