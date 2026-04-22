/**
 * EvidenceGallery — run evidence tab content.
 *
 * Data model:
 *   1. Load all results for the run via `useResults`.
 *   2. For each result, load evidence via `useResultEvidence` (GET
 *      /projects/{slug}/runs/{id}/results/{case_id}/evidence).
 *   3. Flatten into a single list of `{ record, caseId, resultStatus }` tuples.
 *   4. Apply URL-driven status filter chips.
 *   5. Render a CSS grid of `EvidenceCard` tiles.
 *   6. Card click opens `EvidencePreviewModal`.
 *
 * Filter chips are URL-param driven so results are shareable:
 *   ?ev_status=pass,fail,blocked,skipped  (comma-separated, absent = all)
 *
 * States:
 *   Loading — skeleton grid
 *   Empty   — EmptyState with image icon
 *   Error   — ErrorState with Retry
 *   Success — card grid
 *
 * SP3.3 Task 47.
 */

import { useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Image } from "lucide-react";
import { useResults, type ResultStatus } from "../hooks/results";
import { useResultEvidence, type EvidenceRecord } from "../hooks/evidence";
import { EvidenceCard } from "./EvidenceCard";
import { EvidencePreviewModal } from "./EvidencePreviewModal";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvidenceEntry {
  record: EvidenceRecord;
  caseId: string;
  resultStatus: ResultStatus;
}

// ---------------------------------------------------------------------------
// Filter chip
// ---------------------------------------------------------------------------

const ALL_STATUSES: ResultStatus[] = ["pass", "fail", "blocked", "skipped"];

const STATUS_LABEL: Record<ResultStatus, string> = {
  pass: "Pass",
  fail: "Fail",
  blocked: "Blocked",
  skipped: "Skipped",
};

const STATUS_SHAPE: Record<ResultStatus, React.ReactNode> = {
  pass: (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <path d="M1.5 4L3 5.5L6.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  fail: (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <path d="M2 2L6 6M6 2L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  blocked: (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <path d="M2 4H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  skipped: (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <path d="M2 2.5L5.5 4L2 5.5V2.5Z" fill="currentColor" />
      <path d="M6 2.5V5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
};

interface FilterChipProps {
  status: ResultStatus;
  active: boolean;
  count: number;
  onClick: (status: ResultStatus) => void;
}

function FilterChip({ status, active, count, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`Filter by ${status}, ${count} items`}
      onClick={() => onClick(status)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-[11px] font-medium",
        "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
        "transition-all duration-100 cursor-pointer",
      )}
      style={
        active
          ? {
              background: `var(--result-${status}-bg)`,
              color: `var(--result-${status}-fg)`,
              border: `1.5px solid var(--result-${status}-fg)`,
            }
          : {
              background: "var(--bg-surface-2)",
              color: "var(--fg-muted)",
              border: "1.5px solid var(--border-default)",
            }
      }
    >
      <span style={{ color: active ? `var(--result-${status}-fg)` : "var(--fg-muted)" }}>
        {STATUS_SHAPE[status]}
      </span>
      {STATUS_LABEL[status]}
      <span
        className="tabular-nums font-mono text-[10px] px-1 rounded"
        style={{
          background: active ? "rgba(0,0,0,0.1)" : "var(--bg-surface-3)",
          color: active ? `var(--result-${status}-fg)` : "var(--fg-muted)",
        }}
      >
        {count}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Skeleton grid
// ---------------------------------------------------------------------------

function GallerySkeleton() {
  return (
    <div
      className="grid gap-3 p-5"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
      }}
      aria-busy="true"
      aria-label="Loading evidence"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="rounded-md overflow-hidden animate-pulse"
          style={{
            height: "200px",
            background: "var(--bg-surface-2)",
            border: "1px solid var(--border-default)",
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PerResultLoader — loads evidence for one result, feeds into parent
// ---------------------------------------------------------------------------

/**
 * One-result evidence fetcher. Renders nothing — it uses a render-prop
 * / callback pattern to bubble data up to the gallery without polluting
 * the gallery itself with N parallel hooks (React hooks can't be called
 * in a loop).
 *
 * Using a component-per-result lets us call hooks at the component level
 * without violating the Rules of Hooks.
 */
interface PerResultLoaderProps {
  projectSlug: string;
  runId: string;
  caseId: string;
  resultStatus: ResultStatus;
  onLoaded: (entries: EvidenceEntry[]) => void;
}

function PerResultLoader({
  projectSlug,
  runId,
  caseId,
  resultStatus,
  onLoaded,
}: PerResultLoaderProps) {
  const { data: records } = useResultEvidence(projectSlug, runId, caseId);

  // Fire onLoaded when records become available
  useMemo(() => {
    if (records && records.length > 0) {
      onLoaded(
        records.map((record) => ({ record, caseId, resultStatus })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);

  // Pure data-loading component; renders nothing
  return null;
}

// ---------------------------------------------------------------------------
// Main EvidenceGallery
// ---------------------------------------------------------------------------

interface EvidenceGalleryProps {
  projectSlug: string;
  runId: string;
}

export function EvidenceGallery({ projectSlug, runId }: EvidenceGalleryProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [preview, setPreview] = useState<{
    record: EvidenceRecord;
    resultStatus: ResultStatus;
  } | null>(null);
  // Collected entries from all PerResultLoaders
  const [collectedEntries, setCollectedEntries] = useState<EvidenceEntry[]>([]);

  // ── Results query ──────────────────────────────────────────────────────────
  const {
    data: resultsData,
    isLoading: resultsLoading,
    error: resultsError,
    refetch: refetchResults,
  } = useResults(projectSlug, runId);

  const results = resultsData?.data ?? [];

  // ── URL-driven status filter ───────────────────────────────────────────────
  const rawFilter = searchParams.get("ev_status") ?? "";
  const activeFilters = useMemo<Set<ResultStatus>>(() => {
    if (!rawFilter) return new Set();
    const parts = rawFilter.split(",").filter((s): s is ResultStatus =>
      (["pass", "fail", "blocked", "skipped"] as string[]).includes(s),
    );
    return new Set(parts);
  }, [rawFilter]);

  const toggleFilter = useCallback(
    (status: ResultStatus) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const current = new Set(
            (next.get("ev_status") ?? "")
              .split(",")
              .filter((s) => s.length > 0),
          );
          if (current.has(status)) {
            current.delete(status);
          } else {
            current.add(status);
          }
          if (current.size === 0) {
            next.delete("ev_status");
          } else {
            next.set("ev_status", [...current].join(","));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // ── Merge collected entries, deduplicating by record.id ───────────────────
  const allEntries = useMemo<EvidenceEntry[]>(() => {
    const seen = new Set<string>();
    const merged: EvidenceEntry[] = [];
    for (const entry of collectedEntries) {
      if (!seen.has(entry.record.id)) {
        seen.add(entry.record.id);
        merged.push(entry);
      }
    }
    return merged;
  }, [collectedEntries]);

  // ── Callback for PerResultLoader ──────────────────────────────────────────
  const handleLoaded = useCallback((entries: EvidenceEntry[]) => {
    setCollectedEntries((prev) => {
      const existingIds = new Set(prev.map((e) => e.record.id));
      const newEntries = entries.filter((e) => !existingIds.has(e.record.id));
      if (newEntries.length === 0) return prev;
      return [...prev, ...newEntries];
    });
  }, []);

  // ── Count per status ──────────────────────────────────────────────────────
  const countByStatus = useMemo<Record<ResultStatus, number>>(() => {
    const counts: Record<ResultStatus, number> = {
      pass: 0,
      fail: 0,
      blocked: 0,
      skipped: 0,
    };
    for (const entry of allEntries) {
      counts[entry.resultStatus] = (counts[entry.resultStatus] ?? 0) + 1;
    }
    return counts;
  }, [allEntries]);

  // ── Filtered display entries ───────────────────────────────────────────────
  const displayEntries = useMemo<EvidenceEntry[]>(() => {
    if (activeFilters.size === 0) return allEntries;
    return allEntries.filter((e) => activeFilters.has(e.resultStatus));
  }, [allEntries, activeFilters]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCardClick = useCallback((record: EvidenceRecord, resultStatus: ResultStatus) => {
    setPreview({ record, resultStatus });
  }, []);

  const handleModalClose = useCallback(() => {
    setPreview(null);
  }, []);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (resultsLoading) {
    return <GallerySkeleton />;
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (resultsError) {
    return (
      <div className="p-6">
        <ErrorState
          error={resultsError}
          onRetry={() => void refetchResults()}
          title="Failed to load evidence"
        />
      </div>
    );
  }

  return (
    <>
      {/* Per-result evidence loaders (render-less) */}
      {results.map((result) => (
        <PerResultLoader
          key={result.id}
          projectSlug={projectSlug}
          runId={runId}
          caseId={result.case_id}
          resultStatus={result.status as ResultStatus}
          onLoaded={handleLoaded}
        />
      ))}

      {/* Toolbar: filter chips + count */}
      <div
        className="flex items-center gap-2 flex-wrap px-5 py-3 shrink-0 sticky top-0 z-10"
        style={{
          background: "var(--bg-app)",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <span
          className="text-xs font-medium shrink-0 mr-1"
          style={{ color: "var(--fg-muted)" }}
        >
          Filter by status
        </span>
        {ALL_STATUSES.filter((s) => countByStatus[s] > 0 || activeFilters.has(s)).map(
          (status) => (
            <FilterChip
              key={status}
              status={status}
              active={activeFilters.has(status)}
              count={countByStatus[status]}
              onClick={toggleFilter}
            />
          ),
        )}
        {activeFilters.size > 0 && (
          <button
            type="button"
            onClick={() =>
              setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("ev_status");
                return next;
              }, { replace: true })
            }
            className={cn(
              "text-[11px] underline underline-offset-2 ml-1",
              "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded",
            )}
            style={{ color: "var(--fg-muted)" }}
          >
            Clear
          </button>
        )}

        {/* Total count badge */}
        <span className="ml-auto text-xs tabular-nums font-mono" style={{ color: "var(--fg-muted)" }}>
          {displayEntries.length} item{displayEntries.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Gallery grid or empty state */}
      {allEntries.length === 0 && !resultsLoading ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <EmptyState
            icon={<Image className="h-5 w-5" aria-hidden="true" />}
            title="No evidence attached"
            description="Evidence is attached during test execution in the Runner. Screenshots, logs, and other files will appear here once recorded."
          />
        </div>
      ) : displayEntries.length === 0 && activeFilters.size > 0 ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <EmptyState
            icon={<Image className="h-5 w-5" aria-hidden="true" />}
            title="No evidence matches the current filter"
            description="Try clearing the status filter to see all evidence."
          />
        </div>
      ) : (
        <div
          className="grid gap-3 p-5"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            alignItems: "start",
          }}
          role="list"
          aria-label={`Evidence gallery, ${displayEntries.length} items`}
        >
          {displayEntries.map((entry) => (
            <div role="listitem" key={entry.record.id}>
              <EvidenceCard
                record={entry.record}
                resultStatus={entry.resultStatus}
                onClick={(record) => handleCardClick(record, entry.resultStatus)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Preview modal — fresh URL fetched on each open via key */}
      {preview && (
        <EvidencePreviewModal
          key={`${preview.record.id}-${Date.now()}`}
          open={true}
          record={preview.record}
          resultStatus={preview.resultStatus}
          onClose={handleModalClose}
        />
      )}
    </>
  );
}
