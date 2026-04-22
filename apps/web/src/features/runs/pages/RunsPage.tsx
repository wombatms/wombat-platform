import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams, Link } from "react-router-dom";
import { PlayCircle, ListFilter, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { useDensity } from "@/lib/density/useDensity";
import { useRuns } from "../hooks/runs";
import { useEnvironments } from "../hooks/environments";
import { RunsTable, buildEnvironmentMap, type RunRow } from "../components/RunsTable";
import { RunStatusChip } from "../components/RunStatusChip";
import { cn } from "@/lib/utils";
import type { Density } from "@/components/shared/PageHeader";

/* ------------------------------------------------------------------ */
/* URL param helpers                                                    */
/* ------------------------------------------------------------------ */

type StatusFilter = "open" | "closed" | "";

function useRunsParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  const status = (searchParams.get("status") ?? "") as StatusFilter;
  const env = searchParams.get("env") ?? "";
  const owner = searchParams.get("owner") ?? "";
  const q = searchParams.get("q") ?? "";

  const update = useCallback(
    (patch: { status?: string; env?: string; owner?: string; q?: string }) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const apply = (key: string, val: string | undefined) => {
            if (val === undefined) return;
            if (val === "") next.delete(key);
            else next.set(key, val);
          };
          apply("status", patch.status);
          apply("env", patch.env);
          apply("owner", patch.owner);
          apply("q", patch.q);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const clearAll = useCallback(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const hasFilters = Boolean(status || env || owner || q);

  return { status, env, owner, q, update, clearAll, hasFilters };
}

/* ------------------------------------------------------------------ */
/* Status filter chips                                                  */
/* ------------------------------------------------------------------ */

function StatusFilterChips({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (v: StatusFilter) => void;
}) {
  const chips: { label: string; value: StatusFilter }[] = [
    { label: "All", value: "" },
    { label: "Open", value: "open" },
    { label: "Closed", value: "closed" },
  ];

  return (
    <div
      role="group"
      aria-label="Filter by status"
      className="flex items-center gap-1"
    >
      {chips.map((chip) => {
        const active = value === chip.value;
        return (
          <button
            key={chip.value}
            type="button"
            onClick={() => onChange(chip.value)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1 rounded-full text-[11px] font-medium px-2.5 h-6",
              "transition-colors duration-120 outline-none",
              "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
            )}
            style={
              active
                ? {
                    background: "var(--accent-soft)",
                    color: "var(--accent-fg)",
                    border: "1px solid var(--accent-primary)",
                  }
                : {
                    background: "var(--bg-surface-2)",
                    color: "var(--fg-muted)",
                    border: "1px solid var(--border-default)",
                  }
            }
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Environment dropdown filter                                          */
/* ------------------------------------------------------------------ */

function EnvDropdown({
  value,
  environments,
  onChange,
}: {
  value: string;
  environments: { id: string; name: string }[];
  onChange: (envId: string) => void;
}) {
  return (
    <select
      aria-label="Filter by environment"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-7 rounded-md border px-2 text-[12px] outline-none cursor-pointer",
        "transition-[border-color] duration-120",
        "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
        "focus-visible:border-[color:var(--focus-ring)]",
        "appearance-none",
      )}
      style={{
        background: value ? "var(--accent-soft)" : "var(--bg-surface-2)",
        color: value ? "var(--accent-fg)" : "var(--fg-muted)",
        border: value
          ? "1px solid var(--accent-primary)"
          : "1px solid var(--border-default)",
        minWidth: "120px",
      }}
    >
      <option value="">All environments</option>
      {environments.map((env) => (
        <option key={env.id} value={env.id}>
          {env.name}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Text search input                                                    */
/* ------------------------------------------------------------------ */

interface TextSearchProps {
  value: string;
  onChange: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
}

function TextSearch({ value, onChange, inputRef }: TextSearchProps) {
  return (
    <div className="relative flex items-center">
      <svg
        className="absolute left-2.5 h-3.5 w-3.5 pointer-events-none"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        style={{ color: "var(--fg-muted)" }}
      >
        <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <input
        ref={inputRef}
        type="search"
        placeholder="Search runs… (/)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-7 w-48 rounded-md border pl-7 pr-3 text-[12px] outline-none",
          "transition-[border-color,width] duration-200",
          "focus:w-64 focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
          "focus-visible:border-[color:var(--focus-ring)]",
          "placeholder:text-[color:var(--fg-disabled)]",
        )}
        style={{
          background: "var(--bg-surface-1)",
          border: "1px solid var(--border-default)",
          color: "var(--fg-default)",
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filter bar (combines all filter controls)                           */
/* ------------------------------------------------------------------ */

interface FilterBarProps {
  status: StatusFilter;
  env: string;
  q: string;
  hasFilters: boolean;
  environments: { id: string; name: string }[];
  inputRef: React.RefObject<HTMLInputElement>;
  onStatusChange: (v: StatusFilter) => void;
  onEnvChange: (v: string) => void;
  onQChange: (v: string) => void;
  onClearAll: () => void;
  density: Density;
}

function FilterBar({
  status,
  env,
  q,
  hasFilters,
  environments,
  inputRef,
  onStatusChange,
  onEnvChange,
  onQChange,
  onClearAll,
  density,
}: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 border-b",
        density === "compact" ? "px-4 py-1.5" : "px-5 py-2",
      )}
      style={{ borderColor: "var(--border-default)" }}
    >
      <ListFilter
        className="h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
        style={{ color: "var(--fg-muted)" }}
      />

      <StatusFilterChips value={status} onChange={onStatusChange} />

      <div
        className="w-px self-stretch"
        style={{ background: "var(--border-default)" }}
        aria-hidden="true"
      />

      {environments.length > 0 && (
        <EnvDropdown
          value={env}
          environments={environments}
          onChange={onEnvChange}
        />
      )}

      <TextSearch value={q} onChange={onQChange} inputRef={inputRef} />

      {hasFilters && (
        <button
          type="button"
          onClick={onClearAll}
          aria-label="Clear all filters"
          className={cn(
            "inline-flex items-center gap-1 rounded-full text-[11px] font-medium px-2 h-6",
            "transition-colors duration-120 outline-none",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
          )}
          style={{
            color: "var(--fg-muted)",
            border: "1px solid var(--border-default)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--feedback-error-fg)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--feedback-error-fg)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.color = "var(--fg-muted)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-default)";
          }}
        >
          <X className="h-3 w-3" aria-hidden="true" />
          Clear
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                             */
/* ------------------------------------------------------------------ */

function RunsPageSkeleton({ density }: { density: Density }) {
  const rowH = density === "compact" ? "h-7" : "h-9";
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading runs">
      {/* Header skeleton */}
      <div
        className="flex items-center gap-3 px-5 py-3 border-b"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-app)" }}
      >
        <div className="h-5 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-5 w-8 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
      </div>
      {/* Filter bar skeleton */}
      <div className="flex gap-2 px-5 py-2 border-b" style={{ borderColor: "var(--border-default)" }}>
        <div className="h-6 w-8 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-6 w-12 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-6 w-14 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="ml-1 h-6 w-[1px]" style={{ background: "var(--border-default)" }} />
        <div className="h-6 w-28 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-6 w-48 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
      </div>
      {/* Column header skeleton */}
      <div
        className="flex items-center px-3 border-b"
        style={{ height: 34, borderColor: "var(--border-default)", background: "var(--bg-surface-2)" }}
      >
        {[0, 112, 128, 180, 120, 110].map((w, i) => (
          <div key={i} className="px-3" style={{ width: w || undefined, flex: w === 0 ? 1 : undefined }}>
            <div className="h-3 w-12 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
        ))}
      </div>
      {/* Row skeletons */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className={cn("flex items-center px-3 border-b", rowH)}
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {/* Title */}
          <div className="flex-1 px-3">
            <div
              className="h-3 rounded animate-pulse"
              style={{ background: "var(--bg-surface-3)", width: `${45 + (i % 5) * 8}%` }}
            />
          </div>
          {/* Status chip */}
          <div className="px-3" style={{ width: 112 }}>
            <div className="h-5 w-20 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          {/* Environment */}
          <div className="px-3" style={{ width: 128 }}>
            <div className="h-5 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          {/* Progress */}
          <div className="px-3 flex items-center gap-2" style={{ width: 180 }}>
            <div className="h-[5px] flex-1 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
            <div className="h-3 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          {/* Owner */}
          <div className="px-3" style={{ width: 120 }}>
            <div className="h-3 w-14 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          {/* Updated */}
          <div className="px-3" style={{ width: 110 }}>
            <div className="h-3 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RunsPage                                                             */
/* ------------------------------------------------------------------ */

export function RunsPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [density, setDensity, toggleDensity] = useDensity();
  const { status, env, q, hasFilters, update, clearAll } = useRunsParams();

  // Build API filters from URL state
  const filters = useMemo(
    () => ({
      ...(status && { status }),
      ...(env && { environment_id: env }),
      ...(q && { q }),
    }),
    [status, env, q],
  );

  const {
    data: runsInfinite,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useRuns(projectSlug, filters);

  const {
    data: environments = [],
    isLoading: envsLoading,
  } = useEnvironments(projectSlug);

  // Flatten infinite pages into a single array
  const rows = useMemo<RunRow[]>(
    () => runsInfinite?.pages.flatMap((p) => p.data) ?? [],
    [runsInfinite],
  );

  const totalKnown = rows.length;

  const envMap = useMemo(
    () => buildEnvironmentMap(environments),
    [environments],
  );

  // Keyboard: `/` focuses search, `d` toggles density
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === "d" && !isEditing && !e.metaKey && !e.ctrlKey) {
        toggleDensity();
        return;
      }
      if (e.key === "/" && !isEditing) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggleDensity]);

  // Infinite scroll: fetch next page when last row is in view
  // Simplified approach: if user has scrolled near the bottom, load more
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const container = document.querySelector<HTMLDivElement>("[data-runs-scroll]");
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        void fetchNextPage();
      }
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRowClick = useCallback(
    (row: RunRow) => {
      navigate(`/p/${projectSlug}/runs/${row.id}`);
    },
    [navigate, projectSlug],
  );

  const combinedLoading = isLoading || envsLoading;

  return (
    <div className="flex flex-col h-full" data-density={density}>
      <PageHeader
        title="Runs"
        count={combinedLoading ? undefined : totalKnown}
        density={density}
        onDensityChange={setDensity}
        actions={
          <Link
            to={`/p/${projectSlug}/runs/new`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium",
              "transition-colors duration-120 outline-none",
              "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
            )}
            style={{
              background: "var(--accent-primary)",
              color: "var(--fg-inverse)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "var(--accent-primary-hover)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "var(--accent-primary)";
            }}
          >
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
            New run
          </Link>
        }
      />

      <FilterBar
        status={status}
        env={env}
        q={q}
        hasFilters={hasFilters}
        environments={environments}
        inputRef={searchInputRef}
        onStatusChange={(v) => update({ status: v })}
        onEnvChange={(v) => update({ env: v })}
        onQChange={(v) => update({ q: v })}
        onClearAll={clearAll}
        density={density}
      />

      {combinedLoading ? (
        <RunsPageSkeleton density={density} />
      ) : isError ? (
        <div className="p-5">
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<PlayCircle className="h-4 w-4" aria-hidden="true" />}
          title={hasFilters ? "No runs match these filters" : "No runs yet"}
          description={
            hasFilters
              ? "Try adjusting the status filter or clearing the search query."
              : "Create a new run to start executing test cases in this project."
          }
          className="mt-6 ml-5"
          action={
            hasFilters ? (
              <button
                type="button"
                onClick={clearAll}
                className="text-xs underline outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded-sm"
                style={{ color: "var(--accent-fg)" }}
              >
                Clear filters
              </button>
            ) : (
              <Link
                to={`/p/${projectSlug}/runs/new`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium",
                  "transition-colors duration-120 outline-none",
                  "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
                )}
                style={{
                  background: "var(--accent-primary)",
                  color: "var(--fg-inverse)",
                }}
              >
                <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Create first run
              </Link>
            )
          }
        />
      ) : (
        <div className="flex-1 overflow-hidden" data-runs-scroll="true">
          <RunsTable
            data={rows}
            onRowClick={handleRowClick}
            density={density}
            environmentMap={envMap}
          />
          {isFetchingNextPage && (
            <div
              className="flex items-center justify-center py-3 text-[12px]"
              style={{ color: "var(--fg-muted)" }}
            >
              Loading more…
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Re-export sub-components for convenience (e.g. in tests or storybook)
export { RunStatusChip };
