import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BookOpen, PanelRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { FacetBar } from "@/components/shared/FacetBar";
import { EntityTable } from "@/components/shared/EntityTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { PriorityBadge, AutomationBadge } from "@/components/shared/ResourceBadge";
import type { ResourcePriority, ResourceAutomation } from "@/components/shared/ResourceBadge";
import type { Density } from "@/components/shared/PageHeader";
import type { FacetValue } from "@/components/shared/FacetBar";
import { useDensity } from "@/lib/density/useDensity";
import { usePreview } from "@/lib/preview/usePreview";
import { useTestcaseList, type Testcase } from "./useTestcaseList";
import { testcaseColumns } from "./columns";
import { cn } from "@/lib/utils";

const FACET_FIELDS = ["component", "tag", "priority", "automation"];

/* ------------------------------------------------------------------ */
/* Preview pane                                                         */
/* ------------------------------------------------------------------ */

function PreviewPane({ tc }: { tc: Testcase | null }) {
  if (!tc) {
    return (
      <aside
        className="w-80 shrink-0 overflow-y-auto border-l flex items-center justify-center"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-surface-1)",
          color: "var(--fg-disabled)",
          fontSize: "12px",
        }}
      >
        Select a row to preview
      </aside>
    );
  }
  return (
    <aside
      className="w-80 shrink-0 overflow-y-auto border-l"
      style={{
        borderColor: "var(--border-default)",
        background: "var(--bg-surface-1)",
      }}
    >
      <div className="flex flex-col gap-3 p-4">
        <p
          className="font-mono text-[11px] font-semibold"
          style={{ color: "var(--accent-fg)" }}
        >
          {tc.wombat_id}
        </p>
        <p
          className="text-[13px] font-medium leading-snug"
          style={{ color: "var(--fg-default)" }}
        >
          {tc.title}
        </p>
        <dl className="flex flex-col gap-2 text-[12px]">
          {tc.priority && (
            <div className="flex items-center gap-2">
              <dt style={{ color: "var(--fg-muted)", minWidth: "72px" }}>Priority</dt>
              <dd><PriorityBadge priority={tc.priority as ResourcePriority} /></dd>
            </div>
          )}
          {tc.automation && (
            <div className="flex items-center gap-2">
              <dt style={{ color: "var(--fg-muted)", minWidth: "72px" }}>Automation</dt>
              <dd><AutomationBadge automation={tc.automation as ResourceAutomation} /></dd>
            </div>
          )}
          {tc.component && (
            <div className="flex items-center gap-2">
              <dt style={{ color: "var(--fg-muted)", minWidth: "72px" }}>Component</dt>
              <dd style={{ color: "var(--fg-default)" }}>{tc.component}</dd>
            </div>
          )}
          {tc.tags && tc.tags.length > 0 && (
            <div className="flex items-start gap-2">
              <dt style={{ color: "var(--fg-muted)", minWidth: "72px" }}>Tags</dt>
              <dd className="flex flex-wrap gap-1">
                {tc.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded px-1.5 py-0.5 text-[10px]"
                    style={{
                      background: "var(--bg-surface-2)",
                      color: "var(--fg-muted)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {tc.updated_at && (
            <div className="flex items-center gap-2">
              <dt style={{ color: "var(--fg-muted)", minWidth: "72px" }}>Updated</dt>
              <dd className="tabular-nums" style={{ color: "var(--fg-muted)" }}>
                {new Date(tc.updated_at).toLocaleDateString()}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                             */
/* ------------------------------------------------------------------ */

function LibrarySkeleton({ density }: { density: Density }) {
  const rowH = density === "compact" ? "h-7" : "h-9";
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading testcases">
      {/* Header skeleton */}
      <div
        className="flex items-center gap-3 px-5 py-3 border-b"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-app)" }}
      >
        <div className="h-5 w-32 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-5 w-8 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
      </div>
      {/* Facet bar skeleton */}
      <div className="flex gap-2 px-5 py-2 border-b" style={{ borderColor: "var(--border-default)" }}>
        <div className="h-6 w-20 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-6 w-24 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
      </div>
      {/* Column header skeleton */}
      <div
        className="flex items-center px-3 border-b"
        style={{ height: 34, borderColor: "var(--border-default)", background: "var(--bg-surface-2)" }}
      >
        {[140, 0, 96, 116, 180, 120].map((w, i) => (
          <div
            key={i}
            className="px-3"
            style={{ width: w || undefined, flex: w === 0 ? 1 : undefined }}
          >
            <div className="h-3 w-12 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
        ))}
      </div>
      {/* Row skeletons */}
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className={cn("flex items-center px-3 border-b", rowH)}
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="px-3" style={{ width: 140 }}>
            <div className="h-3 w-20 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          <div className="flex-1 px-3">
            <div
              className="h-3 rounded animate-pulse"
              style={{ background: "var(--bg-surface-3)", width: `${55 + (i % 4) * 10}%` }}
            />
          </div>
          <div className="px-3" style={{ width: 96 }}>
            <div className="h-4 w-12 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          <div className="px-3" style={{ width: 116 }}>
            <div className="h-4 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          <div className="flex gap-1 px-3" style={{ width: 180 }}>
            <div className="h-4 w-10 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          <div className="px-3" style={{ width: 120 }}>
            <div className="h-3 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LibraryPage                                                          */
/* ------------------------------------------------------------------ */

export function LibraryPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();

  const [density, setDensity, toggleDensity] = useDensity();
  const [previewOpen, , togglePreview] = usePreview("library");
  const [facets, setFacets] = useState<FacetValue[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [focused, setFocused] = useState<Testcase | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Build filters from facets
  const filters = facets.reduce<Record<string, string[]>>((acc, f) => {
    const k = f.key;
    acc[k] = [...(acc[k] ?? []), f.value];
    return acc;
  }, {});

  const q = filters["q"]?.[0];
  const component = filters["component"]?.[0];
  const tag = filters["tag"];

  const { data, isLoading, isError, error, refetch } = useTestcaseList(
    projectSlug,
    { q, component, tag },
  );

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  // Keyboard: `p` toggles preview, `/` focuses search, `d` toggles density
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === "p" && !isEditing && !e.metaKey && !e.ctrlKey) {
        togglePreview();
        return;
      }
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
  }, [toggleDensity, togglePreview]);

  const handleRowClick = useCallback(
    (row: Testcase) => {
      setSelectedId(row.wombat_id);
      setFocused(row);
      navigate(`/p/${projectSlug}/library/${row.wombat_id}`);
    },
    [navigate, projectSlug],
  );

  return (
    <div
      className="flex flex-col h-full"
      data-density={density}
    >
      <PageHeader
        title="Test Library"
        count={isLoading ? undefined : total}
        density={density}
        onDensityChange={setDensity}
        actions={
          <button
            type="button"
            aria-label={previewOpen ? "Hide preview pane" : "Show preview pane"}
            aria-pressed={previewOpen}
            onClick={togglePreview}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-120",
              "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
            )}
            style={
              previewOpen
                ? { background: "var(--accent-soft)", color: "var(--accent-fg)", border: "1px solid var(--border-default)" }
                : { background: "var(--bg-surface-2)", color: "var(--fg-muted)", border: "1px solid var(--border-default)" }
            }
          >
            <PanelRight className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      />

      <FacetBar
        values={facets}
        available={FACET_FIELDS}
        onChange={setFacets}
        density={density}
        className="border-b border-[color:var(--border-default)]"
      />

      {isLoading ? (
        <LibrarySkeleton density={density} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 min-w-0 overflow-hidden">
            {rows.length === 0 ? (
              <EmptyState
                icon={<BookOpen className="h-4 w-4" aria-hidden="true" />}
                title="No testcases match"
                description={
                  facets.length > 0
                    ? "Try clearing some filters to see more results."
                    : "This project has no testcases yet."
                }
                action={
                  facets.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setFacets([])}
                      className="text-xs underline outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded-sm"
                      style={{ color: "var(--accent-fg)" }}
                    >
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <EntityTable
                data={rows}
                columns={testcaseColumns}
                onRowClick={handleRowClick}
                selectedId={selectedId}
                density={density}
                getRowId={(row) => row.wombat_id}
                aria-label="Testcase list"
                className="h-full"
              />
            )}
          </div>

          {previewOpen && <PreviewPane tc={focused} />}
        </div>
      )}
    </div>
  );
}
