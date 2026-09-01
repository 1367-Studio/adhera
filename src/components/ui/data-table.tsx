import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { Pagination } from "@/components/ui/pagination"
import { cn } from "@/lib/utils"

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  className?: string
  /** Hide this column in the mobile card view */
  hideInCard?: boolean
}

// Opt-in row selection (checkboxes) — entirely additive, existing callers that don't pass
// `selection` render exactly as before. `isSelectable` lets a page restrict which rows can
// be checked at all (e.g. only EN_ATTENTE cotisations for a bulk-reminder action) — those
// rows render a disabled checkbox instead of just omitting it, so the column stays aligned.
export interface DataTableSelection<T> {
  selectedIds:   Set<string>
  onToggle:      (id: string) => void
  onToggleAll:   (ids: string[], checked: boolean) => void
  isSelectable?: (row: T) => boolean
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  keyExtractor: (row: T) => string
  onRowClick?: (row: T) => void
  empty?: React.ReactNode
  selection?: DataTableSelection<T>
  pagination?: {
    page: number
    totalPages: number
    total: number
    limit: number
    onPageChange: (page: number) => void
  }
}

function RowCheckbox({ checked, disabled, onChange, ariaLabel }: {
  checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; ariaLabel: string
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 shrink-0 cursor-pointer rounded border border-input accent-primary disabled:cursor-not-allowed disabled:opacity-40"
    />
  )
}

function HeaderCheckbox({ checked, indeterminate, onChange }: {
  checked: boolean; indeterminate: boolean; onChange: (checked: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label="Tout sélectionner"
      onChange={(e) => onChange(e.target.checked)}
      className="size-4 shrink-0 cursor-pointer rounded border border-input accent-primary"
    />
  )
}

function isActionsCol<T>(col: Column<T>) {
  return col.key === "actions" || col.header === "" || col.header.toLowerCase() === "actions"
}

// A click that ends a text-selection drag (e.g. selecting a cell's value to copy it) still
// fires a click event — without this guard it would also trigger onRowClick.
function hasTextSelection() {
  const selection = typeof window !== "undefined" ? window.getSelection() : null
  return !!selection && selection.toString().length > 0
}

// Only responds when the row/card itself is focused (e.target === e.currentTarget), not a
// descendant like the row-actions trigger — that button already handles its own Enter/Space,
// and letting it bubble here would double-fire onRowClick on top of opening the menu.
function handleActivateKeyDown<T>(e: React.KeyboardEvent, row: T, onRowClick?: (row: T) => void) {
  if (!onRowClick || e.target !== e.currentTarget) return
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault()
    onRowClick(row)
  }
}

const clickableRowFocusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"

function CardSkeleton<T>({ columns }: { columns: Column<T>[] }) {
  const detailCount = columns.filter((c) => !isActionsCol(c)).length - 1
  return (
    <div className="md:hidden space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-8 w-8 rounded-md shrink-0" />
          </div>
          {detailCount > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {Array.from({ length: Math.min(detailCount, 4) }).map((_, j) => (
                <div key={j} className="space-y-1">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function CardList<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  empty,
  selection,
}: Pick<DataTableProps<T>, "columns" | "data" | "keyExtractor" | "onRowClick" | "empty" | "selection">) {
  const t = useTranslations("common")
  const primaryCol = columns.find((c) => !isActionsCol(c) && !c.hideInCard)
  const actionsCol = columns.find(isActionsCol)
  const detailCols = columns.filter((c) => c !== primaryCol && !isActionsCol(c) && !c.hideInCard)
  const isClickable = !!onRowClick

  if (!data.length) {
    return (
      <div className="md:hidden rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        {empty ?? t("noData")}
      </div>
    )
  }

  return (
    <div className="md:hidden space-y-2">
      {data.map((row) => {
        const id = keyExtractor(row)
        const canSelect = !selection || (selection.isSelectable?.(row) ?? true)
        return (
        <div
          key={id}
          data-row-id={id}
          className={cn(
            "rounded-lg border bg-card p-4 space-y-3",
            isClickable && cn("cursor-pointer active:bg-accent/60 transition-colors", clickableRowFocusRing)
          )}
          tabIndex={isClickable ? 0 : undefined}
          role={isClickable ? "button" : undefined}
          onClick={() => { if (!hasTextSelection()) onRowClick?.(row) }}
          onKeyDown={(e) => handleActivateKeyDown(e, row, onRowClick)}
        >
          <div className="flex items-start justify-between gap-2">
            {selection && (
              <div className="shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
                <RowCheckbox
                  checked={selection.selectedIds.has(id)}
                  disabled={!canSelect}
                  onChange={() => selection.onToggle(id)}
                  ariaLabel={`Sélectionner la ligne ${id}`}
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              {primaryCol?.cell(row)}
            </div>
            {actionsCol ? (
              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                {actionsCol.cell(row)}
              </div>
            ) : isClickable ? (
              <CaretRightIcon className="shrink-0 size-4 text-muted-foreground mt-0.5" />
            ) : null}
          </div>

          {detailCols.length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm border-t pt-3">
              {detailCols.map((col) => (
                <div key={col.key} className="min-w-0 overflow-hidden">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">
                    {col.header}
                  </p>
                  <div className="line-clamp-2">{col.cell(row)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        )
      })}
    </div>
  )
}

export function DataTable<T>({
  columns,
  data,
  loading,
  keyExtractor,
  onRowClick,
  empty,
  selection,
  pagination,
}: DataTableProps<T>) {
  const t = useTranslations("common")
  const colCount = columns.length + (selection ? 1 : 0)

  if (loading) {
    return (
      <div className="space-y-3">
        <CardSkeleton columns={columns} />
        <div data-slot="table-wrapper" className="hidden md:block overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {selection && <TableHead className="w-10" />}
                {columns.map((col) => (
                  <TableHead key={col.key} className={col.className}>
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {selection && <TableCell className="w-10" />}
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  if (!data.length) {
    return (
      <div className="space-y-3">
        <CardList columns={columns} data={[]} keyExtractor={keyExtractor} empty={empty} />
        <div data-slot="table-wrapper" className="hidden md:block overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {selection && <TableHead className="w-10" />}
                {columns.map((col) => (
                  <TableHead key={col.key} className={col.className}>
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={colCount} className="h-32 text-center text-muted-foreground">
                  {empty ?? t("noData")}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  // Only rows the caller allows (via isSelectable) count toward "select all" — a page mixing
  // EN_ATTENTE and PAYE cotisations, say, shouldn't have the header checkbox stuck at
  // "indeterminate" forever because it's silently counting rows that can never be checked.
  const selectableIds  = selection ? data.filter(row => selection.isSelectable?.(row) ?? true).map(keyExtractor) : []
  const selectedOnPage = selection ? selectableIds.filter(id => selection.selectedIds.has(id)) : []
  const allSelected    = selection ? selectableIds.length > 0 && selectedOnPage.length === selectableIds.length : false
  const someSelected   = selection ? selectedOnPage.length > 0 && !allSelected : false

  return (
    <div className="space-y-3">
      <CardList
        columns={columns}
        data={data}
        keyExtractor={keyExtractor}
        onRowClick={onRowClick}
        empty={empty}
        selection={selection}
      />

      <div data-slot="table-wrapper" className="hidden md:block overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {selection && (
                <TableHead className="w-10">
                  <HeaderCheckbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={(checked) => selection.onToggleAll(selectableIds, checked)}
                  />
                </TableHead>
              )}
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => {
              const id = keyExtractor(row)
              const canSelect = !selection || (selection.isSelectable?.(row) ?? true)
              return (
              <TableRow
                key={id}
                data-row-id={id}
                className={cn(onRowClick && cn("cursor-pointer", clickableRowFocusRing))}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={() => { if (!hasTextSelection()) onRowClick?.(row) }}
                onKeyDown={(e) => handleActivateKeyDown(e, row, onRowClick)}
              >
                {selection && (
                  <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                    <RowCheckbox
                      checked={selection.selectedIds.has(id)}
                      disabled={!canSelect}
                      onChange={() => selection.onToggle(id)}
                      ariaLabel={`Sélectionner la ligne ${id}`}
                    />
                  </TableCell>
                )}
                {columns.map((col) => (
                  <TableCell key={col.key} className={col.className}>
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {pagination && <Pagination {...pagination} />}
    </div>
  )
}
