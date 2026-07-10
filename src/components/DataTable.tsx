"use client";
import { useMemo, useState } from "react";
import {
  type ColumnDef, flexRender, getCoreRowModel, getFilteredRowModel,
  getPaginationRowModel, getSortedRowModel, type SortingState, useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import clsx from "clsx";
import { downloadCsv } from "@/lib/client";

interface Props<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  onRowClick?: (row: T) => void;
  pageSize?: number;
  searchable?: boolean;
  exportName?: string; // enables CSV export
  dense?: boolean;
  emptyMessage?: string;
}

export default function DataTable<T>({
  data, columns, onRowClick, pageSize = 15, searchable = true, exportName, dense, emptyMessage = "No rows to display.",
}: Props<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
    globalFilterFn: "includesString",
  });

  const exportCsv = useMemo(
    () => () => {
      const headers = table.getAllLeafColumns().map((c) => String(c.columnDef.header ?? c.id));
      const rows = table.getFilteredRowModel().rows.map((r) =>
        r.getAllCells().map((c) => {
          const v = c.getValue();
          return typeof v === "number" ? v : String(v ?? "");
        }),
      );
      downloadCsv(`${exportName}.csv`, headers, rows);
    },
    [table, exportName],
  );

  const pageCount = table.getPageCount();
  const { pageIndex } = table.getState().pagination;
  const total = table.getFilteredRowModel().rows.length;

  return (
    <div>
      {(searchable || exportName) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {searchable ? (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
              <input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder="Search…"
                className="h-8 w-56 rounded-lg border border-line bg-surface pl-8 pr-3 text-[13px] outline-none ring-accent/30 focus:ring-2"
              />
            </div>
          ) : <span />}
          {exportName && (
            <button
              onClick={exportCsv}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink-2 transition hover:bg-ink/5"
            >
              <Download className="size-3.5" /> CSV
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-line bg-surface/70 backdrop-blur">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    className={clsx(
                      "whitespace-nowrap border-l border-grid px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-ink-3 first:border-l-0",
                      h.column.getCanSort() && "cursor-pointer select-none hover:text-ink",
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getCanSort() &&
                        ({ asc: <ArrowUp className="size-3" />, desc: <ArrowDown className="size-3" /> }[
                          h.column.getIsSorted() as string
                        ] ?? <ArrowUpDown className="size-3 opacity-40" />)}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-ink-3">
                  {emptyMessage}
                </td>
              </tr>
            )}
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={clsx(
                  "border-b border-grid last:border-b-0",
                  onRowClick && "cursor-pointer transition hover:bg-accent/5",
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className={clsx("whitespace-nowrap border-l border-grid px-3 first:border-l-0", dense ? "py-1.5" : "py-2")}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-ink-3">
          <span className="tnum">{total.toLocaleString()} rows</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="rounded-lg border border-line p-1.5 transition hover:bg-ink/5 disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" />
            </button>
            <span className="tnum px-2">
              Page {pageIndex + 1} / {pageCount}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="rounded-lg border border-line p-1.5 transition hover:bg-ink/5 disabled:opacity-40"
            >
              <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
