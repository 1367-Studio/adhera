import type { ComponentConfig, Slot } from "@puckeditor/core"
import { cn } from "@/lib/utils"

// "Colonnes": 2 to 4 columns side by side, each one a drop zone. Stacked on small screens.
// No section wrapper: meant to be dropped inside a Section.

export type ColumnsLayout        = "1-1" | "1-2" | "2-1" | "1-1-1" | "1-1-1-1"
export type ColumnsGap           = "small" | "normal" | "large"
export type ColumnsVerticalAlign = "top" | "center"

export type ColumnsBlockProps = {
  layout:        ColumnsLayout
  gap:           ColumnsGap
  verticalAlign: ColumnsVerticalAlign
  column1:       Slot
  column2:       Slot
  column3:       Slot
  column4:       Slot
}

const LAYOUT_SETTINGS: Record<ColumnsLayout, { columnCount: number; gridClass: string }> = {
  "1-1":     { columnCount: 2, gridClass: "md:grid-cols-2" },
  "1-2":     { columnCount: 2, gridClass: "md:grid-cols-3 md:[&>*:nth-child(2)]:col-span-2" },
  "2-1":     { columnCount: 2, gridClass: "md:grid-cols-3 md:[&>*:first-child]:col-span-2" },
  "1-1-1":   { columnCount: 3, gridClass: "md:grid-cols-3" },
  "1-1-1-1": { columnCount: 4, gridClass: "sm:grid-cols-2 lg:grid-cols-4" },
}

const GAP_CLASSES: Record<ColumnsGap, string> = {
  small:  "gap-4",
  normal: "gap-8",
  large:  "gap-12",
}

export const columnsBlock: ComponentConfig<ColumnsBlockProps> = {
  label:  "Colonnes",
  fields: {
    layout: {
      type:    "select",
      label:   "Disposition",
      options: [
        { label: "2 colonnes égales",      value: "1-1" },
        { label: "Étroite + large (1/3 – 2/3)", value: "1-2" },
        { label: "Large + étroite (2/3 – 1/3)", value: "2-1" },
        { label: "3 colonnes",             value: "1-1-1" },
        { label: "4 colonnes",             value: "1-1-1-1" },
      ],
    },
    gap: {
      type:    "radio",
      label:   "Écart",
      options: [
        { label: "Petit",  value: "small" },
        { label: "Normal", value: "normal" },
        { label: "Grand",  value: "large" },
      ],
    },
    verticalAlign: {
      type:    "radio",
      label:   "Alignement vertical",
      options: [
        { label: "En haut", value: "top" },
        { label: "Centré",  value: "center" },
      ],
    },
    column1: { type: "slot", label: "Colonne 1" },
    column2: { type: "slot", label: "Colonne 2" },
    column3: { type: "slot", label: "Colonne 3" },
    column4: { type: "slot", label: "Colonne 4" },
  },
  defaultProps: {
    layout:        "1-1",
    gap:           "normal",
    verticalAlign: "top",
    column1:       [],
    column2:       [],
    column3:       [],
    column4:       [],
  },
  render: ({ layout, gap, verticalAlign, column1, column2, column3, column4 }) => {
    const layoutSettings = LAYOUT_SETTINGS[layout] ?? LAYOUT_SETTINGS["1-1"]
    const visibleColumns = [column1, column2, column3, column4].slice(0, layoutSettings.columnCount)
    return (
      <div
        className={cn(
          "grid grid-cols-1",
          layoutSettings.gridClass,
          GAP_CLASSES[gap],
          verticalAlign === "center" ? "items-center" : "items-start",
        )}
      >
        {visibleColumns.map((ColumnContent, columnIndex) => (
          <ColumnContent key={columnIndex} className="flex min-w-0 flex-col gap-6" minEmptyHeight={80} />
        ))}
      </div>
    )
  },
}
