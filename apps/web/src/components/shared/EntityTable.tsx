import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type RowData,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import type { Density } from "./PageHeader";

// Allow meta-data on column defs without polluting the public API
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    className?: string;
    headerClassName?: string;
  }
}

export interface EntityTableProps<T extends object> {
  data: T[];
  columns: ColumnDef<T>[];
  /** Called when a row is activated (click or Enter). */
  onRowClick?: (row: T) => void;
  /**
   * The id of the currently selected row. Compared against `row.id`
   * (TanStack Table's generated string index) or a `getRowId` you supply.
   */
  selectedId?: string;
  density?: Density;
  /**
   * Optional row id resolver. Defaults to TanStack's numeric index.
   * Pass `(row) => row.wombat_id` for human-ID-keyed tables.
   */
  getRowId?: (row: T) => string;
  /** Accessible label for the table element */
  "aria-label"?: string;
  className?: string;
}

/* Row heights per density */
const ROW_HEIGHT: Record<Density, number> = {
  comfortable: 36,
  compact: 28,
};
const HEADER_HEIGHT = 34;

/**
 * EntityTable<T> — virtualized data table for Wombat list views.
 *
 * - TanStack Table for column definitions + row model.
 * - TanStack Virtual for windowed rendering (smooth at 5 000+ rows).
 * - Sticky header via absolute positioning inside an overflow scroll container.
 * - Keyboard: ↑↓ / j/k navigate, Enter activates, scrolls selection into view.
 * - Selection: full-row highlight with a left accent rule.
 * - Density: comfortable (36px rows) vs compact (28px rows).
 */
export function EntityTable<T extends object>({
  data,
  columns,
  onRowClick,
  selectedId,
  density = "comfortable",
  getRowId,
  "aria-label": ariaLabel,
  className,
}: EntityTableProps<T>) {
  const rowHeight = ROW_HEIGHT[density];
  const scrollRef = useRef<HTMLDivElement>(null);

  // Internal cursor for keyboard navigation (index into virtualizer)
  const [cursor, setCursor] = useState<number>(-1);

  const table = useReactTable<T>({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    ...(getRowId ? { getRowId } : {}),
  });

  const rows = table.getRowModel().rows;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  // Sync cursor to selectedId when it changes externally
  useEffect(() => {
    if (selectedId === undefined) return;
    const idx = rows.findIndex((r) => r.id === selectedId);
    if (idx >= 0) setCursor(idx);
  }, [selectedId, rows]);

  // Scroll cursor row into view
  useEffect(() => {
    if (cursor >= 0 && cursor < rows.length) {
      virtualizer.scrollToIndex(cursor, { align: "auto" });
    }
  }, [cursor, virtualizer, rows.length]);

  const activateRow = useCallback(
    (row: Row<T>) => {
      onRowClick?.(row.original);
    },
    [onRowClick],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const len = rows.length;
      if (len === 0) return;

      if (
        e.key === "ArrowDown" ||
        (e.key === "j" && !e.metaKey && !e.ctrlKey && !e.altKey)
      ) {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, len - 1));
        return;
      }
      if (
        e.key === "ArrowUp" ||
        (e.key === "k" && !e.metaKey && !e.ctrlKey && !e.altKey)
      ) {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
        return;
      }
      if (e.key === "Enter" && cursor >= 0 && cursor < len) {
        e.preventDefault();
        activateRow(rows[cursor]!);
        return;
      }
      // Home / End for fast nav
      if (e.key === "Home") { e.preventDefault(); setCursor(0); }
      if (e.key === "End") { e.preventDefault(); setCursor(len - 1); }
    },
    [rows, cursor, activateRow],
  );

  const headerGroups = table.getHeaderGroups();

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={ariaLabel ?? "Entity table"}
      aria-rowcount={rows.length}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn(
        "relative overflow-auto outline-none",
        "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-inset",
        className,
      )}
      style={{ height: "100%" }}
    >
      {/* Sticky header */}
      <div
        role="rowgroup"
        aria-label="Column headers"
        className="sticky top-0 z-10"
        style={{
          height: HEADER_HEIGHT,
          background: "var(--bg-surface-2)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        {headerGroups.map((hg) => (
          <div
            key={hg.id}
            role="row"
            aria-rowindex={1}
            className="flex h-full items-center"
          >
            {hg.headers.map((header) => (
              <div
                key={header.id}
                role="columnheader"
                aria-sort="none"
                className={cn(
                  "flex items-center px-3 text-[11px] font-semibold uppercase tracking-wider shrink-0",
                  header.column.columnDef.meta?.headerClassName,
                )}
                style={{
                  width: header.getSize(),
                  color: "var(--fg-muted)",
                  flexGrow: header.column.getCanResize() ? 0 : 1,
                }}
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Virtualized body */}
      <div
        role="rowgroup"
        style={{ height: totalHeight, position: "relative" }}
      >
        {virtualItems.map((vItem) => {
          const row = rows[vItem.index]!;
          const isSelected = selectedId !== undefined
            ? row.id === selectedId
            : cursor === vItem.index;
          const isCursor = cursor === vItem.index;

          return (
            <EntityRow
              key={row.id}
              row={row}
              virtualOffset={vItem.start}
              height={rowHeight}
              isSelected={isSelected}
              isCursor={isCursor}
              rowIndex={vItem.index + 2} // +2: 1-based + header row
              onClick={() => {
                setCursor(vItem.index);
                activateRow(row);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EntityRow                                                            */
/* ------------------------------------------------------------------ */

interface EntityRowProps<T extends object> {
  row: Row<T>;
  virtualOffset: number;
  height: number;
  isSelected: boolean;
  isCursor: boolean;
  rowIndex: number;
  onClick: () => void;
}

function EntityRow<T extends object>({
  row,
  virtualOffset,
  height,
  isSelected,
  isCursor,
  rowIndex,
  onClick,
}: EntityRowProps<T>) {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex}
      aria-selected={isSelected}
      tabIndex={-1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "absolute left-0 right-0 flex items-center cursor-pointer",
        "transition-[background-color] duration-[80ms]",
        "border-b outline-none",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--focus-ring)]",
      )}
      style={{
        top: virtualOffset,
        height,
        borderBottomColor: "var(--border-subtle)",
        background: isSelected
          ? "var(--sel-row)"
          : isCursor
            ? "var(--bg-surface-2)"
            : undefined,
      }}
      // Hover via JS since inline style + hover pseudo-class can't combine
      onMouseEnter={(e) => {
        if (!isSelected) {
          (e.currentTarget as HTMLDivElement).style.background =
            "var(--bg-surface-2)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          (e.currentTarget as HTMLDivElement).style.background = "";
        }
      }}
    >
      {/* Left accent rule on selected row */}
      {isSelected && (
        <div
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-[3px] shrink-0"
          style={{ background: "var(--accent-primary)" }}
        />
      )}

      {row.getVisibleCells().map((cell) => (
        <div
          key={cell.id}
          role="gridcell"
          className={cn(
            "flex items-center px-3 text-sm shrink-0 min-w-0",
            cell.column.columnDef.meta?.className,
          )}
          style={{
            width: cell.column.getSize(),
            color: "var(--fg-default)",
            flexGrow: cell.column.getCanResize() ? 0 : 1,
          }}
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </div>
      ))}
    </div>
  );
}
