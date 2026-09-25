"use client"

import { useTranslations } from "next-intl"
import { TrashIcon } from "@phosphor-icons/react/dist/ssr"
import type { PaperFormTarget } from "@/lib/paper-form-targets"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { getPaperFormTargetGroups, getPaperFormTargetLabel } from "./paper-form-target-labels"

// One row as edited: `hint` stays a plain string while typing (emptied → dropped on save),
// `legalDocumentId` is kept even when the target changes away and back, then stripped on save.
export type EditablePaperFormField = {
  key:             string
  label:           string
  page:            number
  target:          PaperFormTarget
  legalDocumentId: string
  hint:            string
}

// "<rowIndex>.<property>" of every control the last save attempt rejected.
export type FieldErrorPaths = ReadonlySet<string>

type LegalDocumentOption = { id: string; title: string }

interface PaperFormFieldsTableProps {
  fields:          EditablePaperFormField[]
  pagesPerForm:    number
  legalDocuments:  LegalDocumentOption[]
  errorPaths:      FieldErrorPaths
  onFieldChange:   (rowIndex: number, patch: Partial<EditablePaperFormField>) => void
  onFieldRemove:   (rowIndex: number) => void
}

export function PaperFormFieldsTable({ fields, pagesPerForm, legalDocuments, errorPaths, onFieldChange, onFieldRemove }: PaperFormFieldsTableProps) {
  const t            = useTranslations("paperFormTemplates.editor")
  const tRoot        = useTranslations()
  const targetGroups = getPaperFormTargetGroups(tRoot)
  const pageNumbers  = Array.from({ length: pagesPerForm }, (_unused, pageIndex) => pageIndex + 1)

  return (
    <div className="rounded-lg border">
      <Table className="min-w-4xl">
        <TableHeader>
          <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
            <TableHead className="w-8 text-right text-muted-foreground">#</TableHead>
            <TableHead>{t("columns.label")}</TableHead>
            <TableHead className="w-20">{t("columns.page")}</TableHead>
            <TableHead className="w-56">{t("columns.target")}</TableHead>
            <TableHead className="w-52">{t("columns.legalDocument")}</TableHead>
            <TableHead className="w-56">{t("columns.hint")}</TableHead>
            <TableHead className="w-11"><span className="sr-only">{t("columns.actions")}</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fields.map((field, rowIndex) => {
            const rowNumber          = rowIndex + 1
            const selectedDocument   = legalDocuments.find(document => document.id === field.legalDocumentId)
            const pageIsOutOfRange   = field.page > pagesPerForm
            return (
              <TableRow key={field.key} className="hover:bg-transparent dark:hover:bg-transparent">
                <TableCell className="text-right text-xs tabular-nums text-muted-foreground">{rowNumber}</TableCell>

                <TableCell>
                  <Input
                    value={field.label}
                    onChange={event => onFieldChange(rowIndex, { label: event.target.value })}
                    placeholder={t("labelPlaceholder")}
                    aria-label={t("rowLabelAria", { row: rowNumber })}
                    aria-invalid={errorPaths.has(`${rowIndex}.label`) || undefined}
                    maxLength={200}
                  />
                </TableCell>

                <TableCell>
                  <Select
                    value={String(field.page)}
                    onValueChange={value => { if (value !== null) onFieldChange(rowIndex, { page: Number(value) }) }}
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={t("rowPageAria", { row: rowNumber })}
                      aria-invalid={pageIsOutOfRange || errorPaths.has(`${rowIndex}.page`) || undefined}
                    >
                      <span className="flex-1 text-left tabular-nums">{field.page}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {pageNumbers.map(pageNumber => (
                        <SelectItem key={pageNumber} value={String(pageNumber)}>{pageNumber}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>

                <TableCell>
                  <Select
                    value={field.target}
                    onValueChange={value => { if (value !== null) onFieldChange(rowIndex, { target: value as PaperFormTarget }) }}
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={t("rowTargetAria", { row: rowNumber })}
                      aria-invalid={errorPaths.has(`${rowIndex}.target`) || undefined}
                    >
                      <span className={cn("min-w-0 flex-1 truncate text-left", field.target === "ignore" && "text-muted-foreground")}>
                        {getPaperFormTargetLabel(tRoot, field.target)}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {targetGroups.map((targetGroup, groupIndex) => (
                        <SelectGroup key={targetGroup.label}>
                          {groupIndex > 0 && <SelectSeparator />}
                          <SelectLabel>{targetGroup.label}</SelectLabel>
                          {targetGroup.options.map(option => (
                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>

                <TableCell>
                  {field.target === "legalDocument" ? (
                    <Select
                      value={field.legalDocumentId}
                      onValueChange={value => { if (value !== null) onFieldChange(rowIndex, { legalDocumentId: value }) }}
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-label={t("rowLegalDocumentAria", { row: rowNumber })}
                        aria-invalid={errorPaths.has(`${rowIndex}.legalDocumentId`) || undefined}
                      >
                        <span className={cn("min-w-0 flex-1 truncate text-left", !selectedDocument && "text-muted-foreground")}>
                          {selectedDocument?.title ?? t("legalDocumentPlaceholder")}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {legalDocuments.length === 0 ? (
                          <p className="px-2 py-1.5 text-sm text-muted-foreground">{t("noLegalDocuments")}</p>
                        ) : legalDocuments.map(document => (
                          <SelectItem key={document.id} value={document.id}>{document.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="px-3 text-muted-foreground">—</span>
                  )}
                </TableCell>

                <TableCell>
                  <Input
                    value={field.hint}
                    onChange={event => onFieldChange(rowIndex, { hint: event.target.value })}
                    placeholder={t("hintPlaceholder")}
                    aria-label={t("rowHintAria", { row: rowNumber })}
                    aria-invalid={errorPaths.has(`${rowIndex}.hint`) || undefined}
                    maxLength={300}
                  />
                </TableCell>

                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onFieldRemove(rowIndex)}
                    aria-label={t("removeRowAria", { row: rowNumber })}
                  >
                    <TrashIcon className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
