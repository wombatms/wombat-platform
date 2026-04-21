import { type RefObject, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Command } from "cmdk";
import { Search, FileText, Share2, BookMarked, X } from "lucide-react";
import { useSearch, type SearchHit } from "./useSearch";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function hitHref(slug: string, hit: SearchHit): string {
  switch (hit.kind) {
    case "shared_step": return `/p/${slug}/shared-steps/${hit.wombat_id}`;
    case "story": return `/p/${slug}/stories/${hit.wombat_id}`;
    default: return `/p/${slug}/library/${hit.wombat_id}`;
  }
}

function kindIcon(kind: string) {
  switch (kind) {
    case "shared_step": return <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
    case "story": return <BookMarked className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
    default: return <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  }
}

function kindColor(kind: string): string {
  switch (kind) {
    case "shared_step": return "var(--feedback-info-fg)";
    case "story": return "var(--chart-cat-4)";
    default: return "var(--accent-fg)";
  }
}

const GROUP_LABEL: Record<string, string> = {
  testcase: "Testcases",
  shared_step: "Shared Steps",
  story: "Stories",
};

/* ------------------------------------------------------------------ */
/* CommandPalette                                                       */
/* ------------------------------------------------------------------ */

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { projectSlug = "" } = useParams<{ projectSlug?: string }>();

  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce 150ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(inputValue), 150);
    return () => clearTimeout(t);
  }, [inputValue]);

  // Focus input when palette opens; reset on close
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setInputValue("");
      setDebouncedQuery("");
    }
  }, [open]);

  // Close on Escape is handled by cmdk Dialog natively, but we add a
  // document-level listener so the backdrop click also closes it.
  const { data, isLoading } = useSearch({
    slug: projectSlug,
    query: debouncedQuery,
    mode: "keyword",
    top_k: 8,
    include_chunks: false,
  });

  const hits = data?.hits ?? [];

  // Group hits by kind
  const groups: Record<string, SearchHit[]> = {};
  for (const hit of hits) {
    const k = hit.kind ?? "testcase";
    groups[k] = [...(groups[k] ?? []), hit];
  }

  const handleSelect = (hit: SearchHit) => {
    if (!projectSlug) return;
    navigate(hitHref(projectSlug, hit));
    onClose();
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close command palette"
        tabIndex={-1}
        className="fixed inset-0 z-50 cursor-default"
        style={{ background: "rgba(0,0,0,0.4)" }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed left-1/2 top-[12vh] z-50 w-full max-w-[560px] -translate-x-1/2"
        style={{
          // Respect prefers-reduced-motion by using a simple visibility transition
          animation: "palette-in 180ms ease-out both",
        }}
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
      >
        <style>{`
          @keyframes palette-in {
            from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
            to   { opacity: 1; transform: translateX(-50%) translateY(0); }
          }
          @media (prefers-reduced-motion: reduce) {
            @keyframes palette-in { from { opacity: 0; } to { opacity: 1; } }
          }
        `}</style>

        <Command
          className="flex flex-col overflow-hidden rounded-lg"
          style={{
            background: "var(--bg-surface-1)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-lg, 0 20px 60px rgba(0,0,0,0.25))",
          }}
          shouldFilter={false}
        >
          {/* Search input row */}
          <div
            className="flex items-center gap-2 px-4 border-b"
            style={{ borderColor: "var(--border-default)", height: 48 }}
          >
            <Search
              className="h-4 w-4 shrink-0"
              aria-hidden="true"
              style={{ color: "var(--fg-muted)" }}
            />
            <Command.Input
              ref={inputRef as RefObject<HTMLInputElement>}
              value={inputValue}
              onValueChange={setInputValue}
              placeholder="Search testcases, shared steps, stories…"
              className={cn(
                "flex-1 bg-transparent text-[13px] outline-none",
                "placeholder:text-[color:var(--fg-disabled)]",
              )}
              style={{ color: "var(--fg-default)" }}
              onKeyDown={(e) => {
                if (e.key === "Escape") onClose();
              }}
            />
            {inputValue && (
              <button
                type="button"
                aria-label="Clear"
                onClick={() => setInputValue("")}
                className="shrink-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
                style={{ color: "var(--fg-muted)" }}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
            <kbd
              className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]"
              style={{
                background: "var(--bg-surface-2)",
                color: "var(--fg-muted)",
                border: "1px solid var(--border-default)",
              }}
            >
              Esc
            </kbd>
          </div>

          {/* Results */}
          <Command.List
            className="overflow-y-auto"
            style={{ maxHeight: "min(420px, 60vh)" }}
          >
            {debouncedQuery.length < 2 ? (
              <Command.Empty>
                <div
                  className="flex flex-col items-center gap-2 py-10 text-center"
                  style={{ color: "var(--fg-muted)" }}
                >
                  <p className="text-[13px]">Type to search…</p>
                  <p className="text-[11px]">Testcases, shared steps, and stories</p>
                </div>
              </Command.Empty>
            ) : isLoading ? (
              <div className="flex flex-col gap-1 p-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md px-3 py-2.5"
                    style={{ background: "var(--bg-surface-2)" }}
                  >
                    <div className="h-3.5 w-3.5 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
                    <div
                      className="h-3 rounded animate-pulse"
                      style={{
                        background: "var(--bg-surface-3)",
                        width: `${45 + (i % 3) * 15}%`,
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : hits.length === 0 ? (
              <Command.Empty>
                <div className="py-10 text-center">
                  <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
                    No results for &ldquo;{debouncedQuery}&rdquo;
                  </p>
                </div>
              </Command.Empty>
            ) : (
              <div className="p-2">
                {Object.entries(groups).map(([kind, groupHits]) => (
                  <Command.Group
                    key={kind}
                    heading={
                      <span
                        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider block"
                        style={{ color: "var(--fg-muted)" }}
                      >
                        {GROUP_LABEL[kind] ?? kind}
                      </span>
                    }
                  >
                    {groupHits.map((hit) => (
                      <Command.Item
                        key={hit.id ?? hit.wombat_id}
                        value={`${hit.wombat_id} ${hit.title}`}
                        onSelect={() => handleSelect(hit)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer",
                          "transition-colors duration-80 outline-none",
                          "data-[selected=true]:bg-[color:var(--accent-soft)]",
                        )}
                        style={{ color: "var(--fg-default)" }}
                      >
                        <span style={{ color: kindColor(kind) }}>
                          {kindIcon(kind)}
                        </span>
                        <span
                          className="font-mono text-[11px] font-semibold shrink-0"
                          style={{ color: kindColor(kind) }}
                        >
                          {hit.wombat_id}
                        </span>
                        <span
                          className="flex-1 min-w-0 truncate text-[13px]"
                          style={{ color: "var(--fg-default)" }}
                        >
                          {hit.title}
                        </span>
                        {hit.score !== undefined && (
                          <span
                            className="shrink-0 tabular-nums text-[10px]"
                            style={{ color: "var(--fg-disabled)" }}
                          >
                            {Math.round(hit.score * 100)}%
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </div>
            )}
          </Command.List>

          {/* Footer hints */}
          <div
            className="flex items-center gap-3 px-4 py-2 border-t text-[10px]"
            style={{
              borderColor: "var(--border-default)",
              color: "var(--fg-disabled)",
              background: "var(--bg-surface-2)",
            }}
          >
            <span className="flex items-center gap-1">
              <kbd className="rounded px-1 py-0.5 font-mono"
                style={{ background: "var(--bg-surface-3)", border: "1px solid var(--border-default)" }}>
                ↑↓
              </kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded px-1 py-0.5 font-mono"
                style={{ background: "var(--bg-surface-3)", border: "1px solid var(--border-default)" }}>
                ↵
              </kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded px-1 py-0.5 font-mono"
                style={{ background: "var(--bg-surface-3)", border: "1px solid var(--border-default)" }}>
                Esc
              </kbd>
              close
            </span>
          </div>
        </Command>
      </div>
    </>
  );
}
