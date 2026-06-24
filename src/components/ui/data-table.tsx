import { ChevronRightIcon } from "lucide-react"
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

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  keyExtractor: (row: T) => string
  onRowClick?: (row: T) => void
  empty?: React.ReactNode
  pagination?: {
    page: number
    totalPages: number
    total: number
    limit: number
    onPageChange: (page: number) => void
  }
}

function isActionsCol<T>(col: Column<T>) {
  return col.key === "actions" || col.header === "" || col.header.toLowerCase() === "actions"
}

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
}: Pick<DataTableProps<T>, "columns" | "data" | "keyExtractor" | "onRowClick" | "empty">) {
  const primaryCol = columns.find((c) => !isActionsCol(c) && !c.hideInCard)
  const actionsCol = columns.find(isActionsCol)
  const detailCols = columns.filter((c) => c !== primaryCol && !isActionsCol(c) && !c.hideInCard)
  const isClickable = !!onRowClick

  if (!data.length) {
    return (
      <div className="md:hidden rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        {empty ?? "Aucune donnée"}
      </div>
    )
  }

  return (
    <div className="md:hidden space-y-2">
      {data.map((row) => (
        <div
          key={keyExtractor(row)}
          className={cn(
            "rounded-lg border bg-card p-4 space-y-3",
            isClickable && "cursor-pointer active:bg-accent/60 transition-colors"
          )}
          onClick={() => onRowClick?.(row)}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {primaryCol?.cell(row)}
            </div>
            {actionsCol ? (
              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                {actionsCol.cell(row)}
              </div>
            ) : isClickable ? (
              <ChevronRightIcon className="shrink-0 size-4 text-muted-foreground mt-0.5" />
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
      ))}
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
  pagination,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="space-y-3">
        <CardSkeleton columns={columns} />
        <div data-slot="table-wrapper" className="hidden md:block overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
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
                {columns.map((col) => (
                  <TableHead key={col.key} className={col.className}>
                    {col.header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                  {empty ?? "Aucune donnée"}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <CardList
        columns={columns}
        data={data}
        keyExtractor={keyExtractor}
        onRowClick={onRowClick}
        empty={empty}
      />

      <div data-slot="table-wrapper" className="hidden md:block overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row) => (
              <TableRow
                key={keyExtractor(row)}
                className={cn(onRowClick && "cursor-pointer")}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <TableCell key={col.key} className={col.className}>
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pagination && <Pagination {...pagination} />}
    </div>
  )
}
