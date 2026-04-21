/**
 * FrontmatterDiffTable — compact field-diff table for proposal review.
 *
 * Design (from frontend-design skill):
 * - Utilitarian/editorial aesthetic: tight rows, monospaced values, surgical color
 * - Changed keys shown by default; unchanged keys collapsed behind a toggle
 * - Old value: struck-through, muted red (--feedback-error-fg at low opacity)
 * - New value: muted green (--feedback-success-fg at low opacity)
 * - Arrow (→) in a neutral middle column
 * - All colors via SP3.1 CSS custom properties — no hardcoded values
 */

import type { CSSProperties } from "react";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface FrontmatterDiffTableProps {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  className?: string;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function isEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface DiffRow {
  key: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

function buildRows(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): DiffRow[] {
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  return allKeys.map((key) => {
    const bVal = before[key];
    const aVal = after[key];
    return { key, before: bVal, after: aVal, changed: !isEqual(bVal, aVal) };
  });
}

function DiffCell({
  value,
  variant,
}: {
  value: unknown;
  variant: "before" | "after" | "unchanged";
}) {
  const text = formatValue(value);

  const styles: CSSProperties =
    variant === "before"
      ? {
          color: "var(--feedback-error-fg)",
          background: "color-mix(in srgb, var(--feedback-error-fg) 8%, transparent)",
          textDecoration: "line-through",
        }
      : variant === "after"
        ? {
            color: "var(--feedback-success-fg)",
            background: "color-mix(in srgb, var(--feedback-success-fg) 8%, transparent)",
          }
        : {
            color: "var(--fg-muted)",
          };

  return (
    <code
      className="inline-block max-w-[240px] truncate rounded px-1.5 py-0.5 text-[11px] font-mono"
      style={styles}
      title={text}
    >
      {text}
    </code>
  );
}

export function FrontmatterDiffTable({
  before,
  after,
  className,
}: FrontmatterDiffTableProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);

  const rows = buildRows(before, after);
  const changedRows = rows.filter((r) => r.changed);
  const unchangedRows = rows.filter((r) => !r.changed);

  const visibleRows = showUnchanged ? rows : changedRows;

  if (rows.length === 0) {
    return (
      <p className="text-[12px] italic" style={{ color: "var(--fg-muted)" }}>
        No frontmatter fields.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-0", className)}>
      <div
        className="overflow-hidden rounded-md"
        style={{ border: "1px solid var(--border-default)" }}
      >
        {/* Header */}
        <div
          className="grid grid-cols-[1fr_16px_1fr] items-center gap-2 px-3 py-1.5"
          style={{
            background: "var(--bg-surface-2)",
            borderBottom: "1px solid var(--border-default)",
          }}
        >
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--fg-muted)" }}
          >
            Before
          </span>
          <span />
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--fg-muted)" }}
          >
            After
          </span>
        </div>

        {/* Rows */}
        {visibleRows.length === 0 ? (
          <div
            className="px-3 py-4 text-center text-[12px] italic"
            style={{ color: "var(--fg-muted)" }}
          >
            No changed fields.
          </div>
        ) : (
          <div role="table" aria-label="Frontmatter diff">
            {visibleRows.map((row, i) => (
              <div
                key={row.key}
                role="row"
                className={cn(
                  "grid grid-cols-[140px_1fr_16px_1fr] items-center gap-2 px-3 py-2",
                  i < visibleRows.length - 1 &&
                    "border-b",
                )}
                style={{
                  borderColor: "var(--border-subtle)",
                  background: row.changed
                    ? "color-mix(in srgb, var(--feedback-warn-fg) 3%, transparent)"
                    : undefined,
                }}
              >
                {/* Key */}
                <div role="rowheader">
                  <span
                    className="font-mono text-[11px] font-semibold"
                    style={{ color: row.changed ? "var(--fg-default)" : "var(--fg-muted)" }}
                  >
                    {row.key}
                  </span>
                </div>

                {/* Before value */}
                <div role="cell">
                  {row.changed ? (
                    <DiffCell value={row.before} variant="before" />
                  ) : (
                    <DiffCell value={row.before} variant="unchanged" />
                  )}
                </div>

                {/* Arrow */}
                <div role="cell" aria-hidden="true">
                  {row.changed && (
                    <span
                      className="text-[11px] font-semibold select-none"
                      style={{ color: "var(--fg-disabled)" }}
                    >
                      →
                    </span>
                  )}
                </div>

                {/* After value */}
                <div role="cell">
                  {row.changed ? (
                    <DiffCell value={row.after} variant="after" />
                  ) : (
                    <DiffCell value={row.after} variant="unchanged" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toggle for unchanged rows */}
      {unchangedRows.length > 0 && (
        <button
          type="button"
          onClick={() => setShowUnchanged((v) => !v)}
          className={cn(
            "mt-1.5 flex items-center gap-1 self-start rounded-md px-2 py-1 text-[11px]",
            "transition-colors duration-120 outline-none",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
          )}
          style={{
            color: "var(--fg-muted)",
            background: "transparent",
          }}
          aria-expanded={showUnchanged}
        >
          {showUnchanged ? (
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          )}
          {showUnchanged
            ? `Hide ${unchangedRows.length} unchanged field${unchangedRows.length !== 1 ? "s" : ""}`
            : `Show ${unchangedRows.length} unchanged field${unchangedRows.length !== 1 ? "s" : ""}`}
        </button>
      )}
    </div>
  );
}
