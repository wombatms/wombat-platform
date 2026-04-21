import { type ReactNode, useEffect, useRef, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Search,
  FileText,
  Share2,
  BookMarked,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/ErrorState";
import { useSearch, type SearchMode, type SearchHit } from "./useSearch";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* URL state helpers                                                    */
/* ------------------------------------------------------------------ */

function useSearchParams() {
  const [params, setParams] = useState(() => {
    const sp = new URLSearchParams(window.location.search);
    return {
      q: sp.get("q") ?? "",
      mode: (sp.get("mode") ?? "hybrid") as SearchMode,
      kinds: sp.getAll("kind"),
      tags: sp.getAll("tag"),
    };
  });

  const updateParams = useCallback(
    (next: Partial<typeof params>) => {
      const merged = { ...params, ...next };
      const sp = new URLSearchParams();
      if (merged.q) sp.set("q", merged.q);
      if (merged.mode !== "hybrid") sp.set("mode", merged.mode);
      merged.kinds.forEach((k) => sp.append("kind", k));
      merged.tags.forEach((t) => sp.append("tag", t));
      window.history.replaceState(null, "", `?${sp.toString()}`);
      setParams(merged);
    },
    [params],
  );

  return { params, updateParams };
}

/* ------------------------------------------------------------------ */
/* Score badge                                                          */
/* ------------------------------------------------------------------ */

function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 90
      ? "var(--feedback-success-fg)"
      : pct >= 70
        ? "var(--feedback-warn-fg)"
        : "var(--fg-muted)";
  return (
    <span
      className="shrink-0 font-mono text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded"
      style={{
        color,
        background: "var(--bg-surface-2)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      {pct}%
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Kind icon map                                                        */
/* ------------------------------------------------------------------ */

const KIND_ICONS: Record<string, ReactNode> = {
  testcase: <FileText className="h-3.5 w-3.5" aria-hidden="true" />,
  shared_step: <Share2 className="h-3.5 w-3.5" aria-hidden="true" />,
  story: <BookMarked className="h-3.5 w-3.5" aria-hidden="true" />,
};

const KIND_LABELS: Record<string, string> = {
  testcase: "Testcases",
  shared_step: "Shared Steps",
  story: "Stories",
};

function kindColor(kind: string): string {
  switch (kind) {
    case "testcase": return "var(--accent-fg)";
    case "shared_step": return "var(--feedback-info-fg)";
    case "story": return "var(--chart-cat-4)";
    default: return "var(--fg-muted)";
  }
}

function hitHref(projectSlug: string, hit: SearchHit): string {
  switch (hit.kind) {
    case "shared_step": return `/p/${projectSlug}/shared-steps/${hit.wombat_id}`;
    case "story": return `/p/${projectSlug}/stories/${hit.wombat_id}`;
    default: return `/p/${projectSlug}/library/${hit.wombat_id}`;
  }
}

/* ------------------------------------------------------------------ */
/* Result hit row                                                       */
/* ------------------------------------------------------------------ */

function HitRow({ hit, projectSlug }: { hit: SearchHit; projectSlug: string }) {
  const href = hitHref(projectSlug, hit);
  return (
    <Link
      to={href}
      className={cn(
        "flex items-start gap-3 rounded-md px-4 py-3 transition-colors duration-100",
        "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
      )}
      style={{ background: "var(--bg-surface-1)", border: "1px solid var(--border-default)" }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--accent-primary)";
        (e.currentTarget as HTMLAnchorElement).style.background = "var(--bg-surface-2)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--border-default)";
        (e.currentTarget as HTMLAnchorElement).style.background = "var(--bg-surface-1)";
      }}
    >
      <span
        className="mt-0.5 shrink-0"
        style={{ color: kindColor(hit.kind) }}
      >
        {KIND_ICONS[hit.kind] ?? <FileText className="h-3.5 w-3.5" aria-hidden="true" />}
      </span>

      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[11px] font-semibold shrink-0"
            style={{ color: kindColor(hit.kind) }}
          >
            {hit.wombat_id}
          </span>
          <span
            className="flex-1 min-w-0 truncate text-[13px] font-medium"
            style={{ color: "var(--fg-default)" }}
          >
            {hit.title}
          </span>
          <ScoreBadge score={hit.score} />
        </div>
        {hit.highlight && (
          <p
            className="text-[12px] leading-relaxed line-clamp-2"
            style={{ color: "var(--fg-muted)" }}
            dangerouslySetInnerHTML={{ __html: hit.highlight.replace(/\*\*(.*?)\*\*/g, "<mark>$1</mark>") }}
          />
        )}
        {hit.tags && hit.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {hit.tags.slice(0, 4).map((t) => (
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
          </div>
        )}
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Grouped results                                                      */
/* ------------------------------------------------------------------ */

function GroupedResults({
  hits,
  projectSlug,
}: {
  hits: SearchHit[];
  projectSlug: string;
}) {
  const groups = ["testcase", "shared_step", "story"].reduce<
    Record<string, SearchHit[]>
  >((acc, kind) => {
    const g = hits.filter((h) => h.kind === kind);
    if (g.length > 0) acc[kind] = g;
    return acc;
  }, {});

  if (Object.keys(groups).length === 0) {
    return (
      <div
        className="flex flex-col items-start gap-2 px-5 py-10"
        style={{ color: "var(--fg-muted)" }}
      >
        <p className="text-sm font-medium" style={{ color: "var(--fg-default)" }}>No results found</p>
        <p className="text-xs">Try a different query or search mode.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-5 py-5">
      {Object.entries(groups).map(([kind, groupHits]) => (
        <section key={kind} aria-label={`${KIND_LABELS[kind] ?? kind} results`}>
          <div className="flex items-center gap-2 mb-3">
            <span style={{ color: kindColor(kind) }}>
              {KIND_ICONS[kind]}
            </span>
            <h2
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--fg-muted)" }}
            >
              {KIND_LABELS[kind] ?? kind}
            </h2>
            <span
              className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full"
              style={{
                background: "var(--accent-soft)",
                color: "var(--accent-fg)",
              }}
            >
              {groupHits.length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {groupHits.map((hit) => (
              <HitRow key={hit.id ?? hit.wombat_id} hit={hit} projectSlug={projectSlug} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Search skeleton                                                      */
/* ------------------------------------------------------------------ */

function SearchSkeleton() {
  return (
    <div className="flex flex-col gap-6 px-5 py-5" aria-busy="true" aria-label="Searching">
      {[3, 2].map((count, gi) => (
        <div key={gi} className="flex flex-col gap-2">
          <div className="h-3 w-24 rounded animate-pulse mb-1" style={{ background: "var(--bg-surface-3)" }} />
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="rounded-md px-4 py-3 flex flex-col gap-2"
              style={{ background: "var(--bg-surface-1)", border: "1px solid var(--border-default)" }}>
              <div className="flex items-center gap-2">
                <div className="h-3 w-16 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
                <div className="h-3 flex-1 rounded animate-pulse" style={{ background: "var(--bg-surface-3)", maxWidth: "60%" }} />
                <div className="h-4 w-8 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
              </div>
              <div className="h-3 w-4/5 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SearchPage                                                           */
/* ------------------------------------------------------------------ */

const MODES: SearchMode[] = ["hybrid", "semantic", "keyword"];
const ALL_KINDS = ["testcase", "shared_step", "story"];

export function SearchPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const { params, updateParams } = useSearchParams();
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState(params.q);

  // Debounce query into URL state
  useEffect(() => {
    const t = setTimeout(() => {
      if (inputValue !== params.q) updateParams({ q: inputValue });
    }, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue]); // intentionally omit updateParams/params.q from dep to avoid loop

  // Focus search on `/` key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA") return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const toggleKind = (kind: string) => {
    const next = params.kinds.includes(kind)
      ? params.kinds.filter((k) => k !== kind)
      : [...params.kinds, kind];
    updateParams({ kinds: next });
  };

  const { data, isLoading, isError, error, refetch } = useSearch({
    slug: projectSlug,
    query: params.q,
    mode: params.mode,
    kinds: params.kinds.length > 0 ? params.kinds : undefined,
    tags: params.tags.length > 0 ? params.tags : undefined,
  });

  const hits = data?.hits ?? [];
  const filteredHits =
    params.kinds.length > 0
      ? hits.filter((h) => params.kinds.includes(h.kind))
      : hits;

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="Search" />

      {/* Search controls */}
      <div
        className="flex flex-col gap-3 px-5 py-4 border-b shrink-0"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-app)" }}
      >
        {/* Search input */}
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none"
            aria-hidden="true"
            style={{ color: "var(--fg-muted)" }}
          />
          <input
            ref={inputRef}
            type="search"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setInputValue("");
                updateParams({ q: "" });
              }
            }}
            placeholder="Search testcases, shared steps, stories…"
            aria-label="Search query"
            className={cn(
              "w-full h-9 rounded-md pl-9 pr-9 text-[13px] outline-none",
              "transition-[border-color,box-shadow] duration-150",
              "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]/30",
              "focus-visible:border-[color:var(--focus-ring)]",
              "placeholder:text-[color:var(--fg-disabled)]",
            )}
            style={{
              background: "var(--bg-surface-1)",
              border: "1px solid var(--border-default)",
              color: "var(--fg-default)",
            }}
          />
          {inputValue && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => { setInputValue(""); updateParams({ q: "" }); inputRef.current?.focus(); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
              style={{ color: "var(--fg-muted)" }}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Mode + kind filter row */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Mode selector */}
          <div
            role="group"
            aria-label="Search mode"
            className="flex items-center rounded-md overflow-hidden shrink-0"
            style={{ border: "1px solid var(--border-default)", background: "var(--bg-surface-2)" }}
          >
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={params.mode === m}
                onClick={() => updateParams({ mode: m })}
                className={cn(
                  "px-3 h-7 text-[11px] font-medium capitalize transition-colors duration-120",
                  "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-inset",
                  "border-r last:border-0",
                )}
                style={
                  params.mode === m
                    ? {
                        background: "var(--accent-soft)",
                        color: "var(--accent-fg)",
                        borderColor: "var(--border-default)",
                      }
                    : {
                        background: "transparent",
                        color: "var(--fg-muted)",
                        borderColor: "var(--border-default)",
                      }
                }
              >
                {m}
              </button>
            ))}
          </div>

          {/* Kind chips */}
          <div
            role="group"
            aria-label="Filter by kind"
            className="flex flex-wrap items-center gap-1.5"
          >
            {ALL_KINDS.map((kind) => {
              const active = params.kinds.includes(kind);
              return (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleKind(kind)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 h-6 text-[11px] font-medium",
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
                          background: "transparent",
                          color: "var(--fg-muted)",
                          border: "1px solid var(--border-default)",
                        }
                  }
                >
                  <span style={{ color: active ? "var(--accent-fg)" : kindColor(kind) }}>
                    {KIND_ICONS[kind]}
                  </span>
                  {KIND_LABELS[kind]}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-y-auto">
        {params.q.length < 2 ? (
          <div
            className="flex flex-col items-center justify-center gap-3 py-20"
            style={{ color: "var(--fg-muted)" }}
          >
            <Search
              className="h-10 w-10 opacity-30"
              aria-hidden="true"
            />
            <p
              className="text-[14px] font-medium"
              style={{ color: "var(--fg-default)" }}
            >
              Type to search
            </p>
            <p className="text-[12px] text-center max-w-xs">
              Search across testcases, shared steps, and stories. Use hybrid mode for best results.
            </p>
            <div className="flex items-center gap-1 mt-2 text-[11px]">
              <kbd
                className="rounded px-1.5 py-0.5 font-mono"
                style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border-default)" }}
              >
                /
              </kbd>
              <span style={{ color: "var(--fg-disabled)" }}>to focus search</span>
            </div>
          </div>
        ) : isLoading ? (
          <SearchSkeleton />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} className="m-5" />
        ) : (
          <GroupedResults hits={filteredHits} projectSlug={projectSlug} />
        )}
      </div>

      {/* Result count footer */}
      {!isLoading && !isError && params.q.length >= 2 && (
        <div
          className="shrink-0 px-5 py-2 text-[11px] border-t"
          style={{
            borderColor: "var(--border-default)",
            color: "var(--fg-muted)",
            background: "var(--bg-surface-1)",
          }}
        >
          {filteredHits.length > 0
            ? `${filteredHits.length} result${filteredHits.length !== 1 ? "s" : ""} · mode: ${params.mode}`
            : `No results for "${params.q}"`}
        </div>
      )}
    </div>
  );
}
