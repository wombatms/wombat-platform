import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BookMarked, PanelRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { FacetBar } from "@/components/shared/FacetBar";
import { EntityTable } from "@/components/shared/EntityTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import type { Density } from "@/components/shared/PageHeader";
import type { FacetValue } from "@/components/shared/FacetBar";
import { useDensity } from "@/lib/density/useDensity";
import { usePreview } from "@/lib/preview/usePreview";
import { useStoryList, type Story } from "./useStoryList";
import { storyColumns } from "./columns";
import { cn } from "@/lib/utils";

function PreviewPane({ story }: { story: Story | null }) {
  if (!story) {
    return (
      <aside
        className="w-80 shrink-0 border-l flex items-center justify-center text-[12px]"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-surface-1)", color: "var(--fg-disabled)" }}
      >
        Select a row to preview
      </aside>
    );
  }
  return (
    <aside
      className="w-80 shrink-0 overflow-y-auto border-l"
      style={{ borderColor: "var(--border-default)", background: "var(--bg-surface-1)" }}
    >
      <div className="flex flex-col gap-3 p-4">
        <p className="font-mono text-[11px] font-semibold" style={{ color: "var(--chart-cat-4)" }}>
          {story.wombat_id}
        </p>
        <p className="text-[13px] font-medium leading-snug" style={{ color: "var(--fg-default)" }}>
          {story.title}
        </p>
        {story.tags && story.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {story.tags.map((t) => (
              <span key={t} className="rounded px-1.5 py-0.5 text-[10px]"
                style={{ background: "var(--bg-surface-2)", color: "var(--fg-muted)", border: "1px solid var(--border-subtle)" }}>
                {t}
              </span>
            ))}
          </div>
        )}
        {story.updated_at && (
          <p className="text-[12px] tabular-nums" style={{ color: "var(--fg-muted)" }}>
            Updated {new Date(story.updated_at).toLocaleDateString()}
          </p>
        )}
      </div>
    </aside>
  );
}

function ListSkeleton({ density }: { density: Density }) {
  const rowH = density === "compact" ? "h-7" : "h-9";
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading stories">
      <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: "var(--border-default)", background: "var(--bg-app)" }}>
        <div className="h-5 w-24 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-5 w-8 rounded-full animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
      </div>
      <div className="flex items-center px-3 border-b" style={{ height: 34, borderColor: "var(--border-default)", background: "var(--bg-surface-2)" }}>
        {[140, 0, 200, 120].map((w, i) => (
          <div key={i} className="px-3" style={{ width: w || undefined, flex: w === 0 ? 1 : undefined }}>
            <div className="h-3 w-12 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
        ))}
      </div>
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className={cn("flex items-center px-3 border-b", rowH)} style={{ borderColor: "var(--border-subtle)" }}>
          <div className="px-3" style={{ width: 140 }}>
            <div className="h-3 w-20 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          <div className="flex-1 px-3">
            <div className="h-3 rounded animate-pulse" style={{ background: "var(--bg-surface-3)", width: `${55 + (i % 4) * 10}%` }} />
          </div>
          <div className="px-3" style={{ width: 200 }}>
            <div className="h-4 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
          <div className="px-3" style={{ width: 120 }}>
            <div className="h-3 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StoryListPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const [density, setDensity, toggleDensity] = useDensity();
  const [previewOpen, , togglePreview] = usePreview("stories");
  const [facets, setFacets] = useState<FacetValue[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [focused, setFocused] = useState<Story | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable) return;
      if (e.key === "p" && !e.metaKey && !e.ctrlKey) togglePreview();
      if (e.key === "d" && !e.metaKey && !e.ctrlKey) toggleDensity();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggleDensity, togglePreview]);

  const filters = facets.reduce<Record<string, string[]>>((acc, f) => {
    acc[f.key] = [...(acc[f.key] ?? []), f.value];
    return acc;
  }, {});
  const tag = filters["tag"];

  const { data, isLoading, isError, error, refetch } = useStoryList(projectSlug, { tag });
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;

  const handleRowClick = useCallback((row: Story) => {
    setSelectedId(row.wombat_id);
    setFocused(row);
    navigate(`/p/${projectSlug}/stories/${row.wombat_id}`);
  }, [navigate, projectSlug]);

  return (
    <div className="flex flex-col h-full" data-density={density}>
      <PageHeader
        title="Stories"
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
        available={["tag"]}
        onChange={setFacets}
        density={density}
        className="border-b border-[color:var(--border-default)]"
      />

      {isLoading ? (
        <ListSkeleton density={density} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 min-w-0 overflow-hidden">
            {rows.length === 0 ? (
              <EmptyState
                icon={<BookMarked className="h-4 w-4" aria-hidden="true" />}
                title="No stories match"
                description={facets.length > 0 ? "Try clearing some filters." : "This project has no stories yet."}
                action={
                  facets.length > 0 ? (
                    <button type="button" onClick={() => setFacets([])}
                      className="text-xs underline outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded-sm"
                      style={{ color: "var(--accent-fg)" }}>
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <EntityTable
                data={rows}
                columns={storyColumns}
                onRowClick={handleRowClick}
                selectedId={selectedId}
                density={density}
                getRowId={(row) => row.wombat_id}
                aria-label="Story list"
                className="h-full"
              />
            )}
          </div>
          {previewOpen && <PreviewPane story={focused} />}
        </div>
      )}
    </div>
  );
}
