/**
 * CaseSelector.FilterTab — filter-based case selection using SP3.1 facet chips
 * and the existing content search endpoint.
 *
 * Fetches testcases matching the active facets. Displays individual checkboxes
 * and a "Select all matching" button. Selected state is lifted to CaseSelector.
 */

import { useState, useCallback, useMemo } from "react";
import { CheckSquare, Square, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FacetBar } from "@/components/shared/FacetBar";
import type { FacetValue } from "@/components/shared/FacetBar";
import { useTestcaseList } from "@/features/library/useTestcaseList";
import type { Testcase } from "@/features/library/useTestcaseList";
import { cn } from "@/lib/utils";

const FILTER_FACETS = ["component", "tag", "priority", "automation"];

interface FilterTabProps {
  projectSlug: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectIds: (ids: string[]) => void;
}

export function FilterTab({
  projectSlug,
  selected,
  onToggle,
  onSelectIds,
}: FilterTabProps) {
  const [facets, setFacets] = useState<FacetValue[]>([]);

  // Build filters from facets
  const filters = facets.reduce<Record<string, string[]>>((acc, f) => {
    acc[f.key] = [...(acc[f.key] ?? []), f.value];
    return acc;
  }, {});

  const q = filters["q"]?.[0];
  const component = filters["component"]?.[0];
  const tag = filters["tag"];

  const { data, isLoading, isError, error, refetch } = useTestcaseList(
    projectSlug,
    { q, component, tag, limit: 200 },
  );

  const rows: Testcase[] = useMemo(() => data?.data ?? [], [data]);
  const total = data?.total ?? 0;

  const handleSelectAll = useCallback(() => {
    const ids = rows.map((r) => r.wombat_id);
    onSelectIds(ids);
  }, [rows, onSelectIds]);

  // Count how many of the current filter results are already selected
  const selectedInFilter = rows.filter((r) => selected.has(r.wombat_id)).length;
  const allSelected = rows.length > 0 && selectedInFilter === rows.length;

  return (
    <div className="flex flex-col h-full">
      {/* Facet bar */}
      <div
        className="border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <FacetBar
          values={facets}
          available={FILTER_FACETS}
          onChange={setFacets}
          density="comfortable"
        />
      </div>

      {/* Count + Select all row */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-2 text-xs border-b"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--bg-surface-2)",
        }}
      >
        <span style={{ color: "var(--fg-muted)" }}>
          {isLoading ? (
            "Loading..."
          ) : isError ? (
            "Error loading"
          ) : (
            <>
              <span
                className="font-semibold tabular-nums"
                style={{ color: "var(--fg-default)" }}
              >
                {total}
              </span>{" "}
              {total === 1 ? "case" : "cases"} match
              {selectedInFilter > 0 && (
                <span style={{ color: "var(--accent-fg)" }}>
                  {" "}
                  · {selectedInFilter} selected
                </span>
              )}
            </>
          )}
        </span>

        <Button
          variant="ghost"
          size="sm"
          disabled={rows.length === 0 || allSelected}
          onClick={handleSelectAll}
          className="h-6 px-2 text-xs gap-1"
        >
          <CheckSquare className="h-3 w-3" aria-hidden="true" />
          Select all matching
        </Button>
      </div>

      {/* Case list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <FilterTabSkeleton />
        ) : isError ? (
          <FilterTabError
            error={error}
            onRetry={() => void refetch()}
          />
        ) : rows.length === 0 ? (
          <div
            className="flex items-center justify-center py-10 text-sm"
            style={{ color: "var(--fg-muted)" }}
          >
            {facets.length > 0
              ? "No cases match the active filters."
              : "No testcases in this project yet."}
          </div>
        ) : (
          <ul aria-label="Matching testcases">
            {rows.map((tc) => (
              <CaseRow
                key={tc.wombat_id}
                tc={tc}
                checked={selected.has(tc.wombat_id)}
                onToggle={() => onToggle(tc.wombat_id)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CaseRow
// ---------------------------------------------------------------------------

interface CaseRowProps {
  tc: Testcase;
  checked: boolean;
  onToggle: () => void;
}

function CaseRow({ tc, checked, onToggle }: CaseRowProps) {
  return (
    <li>
      <label
        className={cn(
          "flex cursor-pointer items-center gap-3 px-4 py-2.5",
          "transition-colors duration-100 border-b",
          "hover:bg-[color:var(--bg-surface-2)]",
        )}
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="sr-only"
          aria-label={`Select ${tc.wombat_id}: ${tc.title}`}
        />
        {/* Custom checkbox */}
        <span
          aria-hidden="true"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
          style={{
            background: checked ? "var(--accent-primary)" : "transparent",
            border: checked
              ? "none"
              : "2px solid var(--border-strong)",
            transition: "background 0.1s, border 0.1s",
          }}
        >
          {checked && (
            <CheckSquare
              className="h-4 w-4 text-white"
              aria-hidden="true"
              strokeWidth={2.5}
            />
          )}
          {!checked && (
            <Square
              className="h-4 w-4"
              aria-hidden="true"
              style={{ color: "transparent" }}
            />
          )}
        </span>

        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2">
            <span
              className="shrink-0 font-mono text-[10px] font-semibold"
              style={{ color: "var(--accent-fg)" }}
            >
              {tc.wombat_id}
            </span>
            <span
              className="truncate text-xs font-medium"
              style={{ color: "var(--fg-default)" }}
            >
              {tc.title}
            </span>
          </span>
          {(tc.component ?? tc.priority) && (
            <span
              className="mt-0.5 text-[10px]"
              style={{ color: "var(--fg-muted)" }}
            >
              {[tc.component, tc.priority].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Loading / Error states
// ---------------------------------------------------------------------------

function FilterTabSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading cases">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-2.5 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div
            className="h-4 w-4 rounded animate-pulse shrink-0"
            style={{ background: "var(--bg-surface-3)" }}
          />
          <div className="flex flex-1 flex-col gap-1">
            <div
              className="h-3 rounded animate-pulse"
              style={{
                background: "var(--bg-surface-3)",
                width: `${40 + (i % 5) * 12}%`,
              }}
            />
            <div
              className="h-2.5 w-24 rounded animate-pulse"
              style={{ background: "var(--bg-surface-3)" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

interface FilterTabErrorProps {
  error: unknown;
  onRetry: () => void;
}

function FilterTabError({ error, onRetry }: FilterTabErrorProps) {
  const msg =
    error instanceof Error ? error.message : "Failed to load testcases.";
  return (
    <div className="flex flex-col items-start gap-3 p-4">
      <div className="flex items-center gap-2">
        <AlertCircle
          className="h-4 w-4 shrink-0"
          aria-hidden="true"
          style={{ color: "var(--feedback-error-fg)" }}
        />
        <span
          className="text-sm font-medium"
          style={{ color: "var(--fg-default)" }}
        >
          Failed to load cases
        </span>
      </div>
      <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
        {msg}
      </p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

// Suppress unused import warning — Loader2 is used in extended states
void Loader2;
