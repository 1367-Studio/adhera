"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { PaperFormCommitResult } from "@/lib/schemas/paper-form"

export type CommitResultRow = {
  formId: string
  name:   string
  result: PaperFormCommitResult
}

type ScanResultStepProps = {
  rows:               CommitResultRow[]
  // Why the batch stopped early (plan limit…): forms after it were not sent at all.
  batchError:         string | null
  legalDocumentTitles: Map<string, string>
  remainingCount:     number
  onBackToReview:     () => void
}

export function ScanResultStep({ rows, batchError, legalDocumentTitles, remainingCount, onBackToReview }: ScanResultStepProps) {
  const t = useTranslations("paperFormScan.result")
  const createdCount = rows.filter((row) => row.result.status === "created").length
  const errorCount   = rows.length - createdCount

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm font-medium">{t("summary", { created: createdCount, errors: errorCount })}</p>
        {batchError && <p className="text-sm text-destructive">{batchError}</p>}
        {remainingCount > 0 && <p className="text-sm text-muted-foreground">{t("remaining", { count: remainingCount })}</p>}
      </div>

      {rows.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("nameColumn")}</TableHead>
                <TableHead className="w-28">{t("statusColumn")}</TableHead>
                <TableHead>{t("detailColumn")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.formId}>
                  <TableCell>
                    {row.result.status === "created" ? (
                      <Link href={`/dashboard/membres/${row.result.membreId}`} className="underline-offset-4 hover:underline">{row.name}</Link>
                    ) : row.name}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.result.status === "created" ? "success" : "destructive"}>
                      {row.result.status === "created" ? t("created") : t("error")}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {row.result.status === "error"
                      ? <span className="text-destructive">{row.result.error}</span>
                      : row.result.skippedLegalDocumentIds.length > 0
                        ? t("skippedDocuments", {
                            documents: row.result.skippedLegalDocumentIds.map((documentId) => legalDocumentTitles.get(documentId) ?? documentId).join(", "),
                          })
                        : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap justify-between gap-3">
        {remainingCount > 0 || errorCount > 0
          ? <Button variant="outline" onClick={onBackToReview}>{t("backToReview")}</Button>
          : <span />}
        <Button nativeButton={false} render={<Link href="/dashboard/membres" />}>{t("goToMembers")}</Button>
      </div>
    </div>
  )
}
