import { STACKED_TABLE } from "@/components/admin/admin-bulk";

/** On narrow screens, keep a record's identity above paired facts and its actions. */
export const STOCK_TABLE = {
  ...STACKED_TABLE,
  th: "px-3 py-2",
  row: "grid grid-cols-2 items-baseline gap-x-3 gap-y-1 border-b border-border px-3 py-2.5 last:border-b-0 sm:grid-cols-3 lg:table-row lg:p-0",
  cell: "block min-w-0 break-words first:col-span-full max-lg:[&:not([data-label])]:col-span-full lg:table-cell lg:px-3 lg:py-2 lg:align-middle",
  labelled: "max-lg:before:mr-1 max-lg:before:text-xs max-lg:before:text-muted-foreground max-lg:before:content-[attr(data-label)] max-lg:first:before:hidden",
} as const;
