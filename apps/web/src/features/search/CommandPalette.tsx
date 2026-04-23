/**
 * CommandPalette — ⌘K command + search overlay.
 *
 * SP3.4 additions (Task 54, frontend-design skill):
 *   - New "Plans & Suites" command group with 6 actions:
 *       New plan, New suite, Open dashboard, Open plans, Open suites,
 *       Resolve plan… (typeahead sub-prompt)
 *   - New PaletteMode "resolve-plan" mirrors the existing "jump-to-run"
 *     two-step pattern: selecting the command enters a sub-mode; typing
 *     filters usePlansList results; pressing Enter navigates to the plan
 *     detail page.
 *
 * Design decisions (frontend-design skill, Task 54):
 *   - "Plans & Suites" group uses ClipboardList (plan) + Layers (suite) icons.
 *   - Accent token var(--chart-cat-3) (warm amber) for plan items —
 *     same token used on the PlanContextStrip in RunCreatePage so the
 *     visual language is consistent.
 *   - Suite items use var(--chart-cat-2) (teal/cyan) for distinction.
 *   - The "resolve-plan" sub-mode renders an immediate list (no min-2-chars
 *     guard) since plans are bounded; falls back to debounced filter for
 *     large project counts.
 *   - Group heading style, item padding, kbd hints, and ActionHint reuse
 *     the existing patterns verbatim.
 */

import { type RefObject, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Command } from "cmdk";
import {
  Search,
  FileText,
  Share2,
  BookMarked,
  X,
  PlayCircle,
  Rocket,
  MoveRight,
  ClipboardList,
  Layers,
  LayoutDashboard,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearch, type SearchHit } from "./useSearch";
import { runKeys } from "@/features/runs/queryKeys";
import type { RunSummary, RunListPage } from "@/features/runs/hooks/runs";
import { usePlansList, type PlanSummary } from "@/features/plans/hooks";
import { api } from "@/lib/api/client";
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
/* Mode types                                                           */
/* ------------------------------------------------------------------ */

/**
 * "default"      — shows static action commands + search results.
 * "jump-to-run"  — shows a debounced run title search sub-prompt.
 * "resolve-plan" — shows a plan typeahead sub-prompt; selecting navigates
 *                  to the plan detail page (which shows resolved cases).
 */
type PaletteMode = "default" | "jump-to-run" | "resolve-plan";

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
  const qc = useQueryClient();

  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [mode, setMode] = useState<PaletteMode>("default");
  const [runResults, setRunResults] = useState<RunSummary[]>([]);
  const [runSearchLoading, setRunSearchLoading] = useState(false);
  const [latestRunLoading, setLatestRunLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // SP3.4 — Plans list for "resolve-plan" sub-mode.
  // Passing an empty slug when not in resolve-plan mode disables the query
  // (usePlansList has `enabled: Boolean(slug)`), preventing unnecessary
  // background fetches while the palette is open in other modes.
  const {
    data: allPlans = [],
    isLoading: plansLoading,
  } = usePlansList(
    mode === "resolve-plan" ? projectSlug : "",
    // Pass a live filter when enough chars typed; show all plans otherwise.
    debouncedQuery.length >= 2 ? { q: debouncedQuery } : {},
  );

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
      setMode("default");
      setRunResults([]);
    }
  }, [open]);

  // SP3.4 — "resolve-plan" sub-mode is only active (query enabled) while in that mode.
  // usePlansList is always called (hooks rule) but the `enabled` guard inside the hook
  // prevents a fetch when projectSlug is empty.  Client-side filtering is good enough
  // for typical plan counts (<200); the debounced `q` param handles larger sets.

  // Fetch run search results when in jump-to-run mode
  useEffect(() => {
    if (mode !== "jump-to-run" || !projectSlug) return;
    if (debouncedQuery.length < 2) {
      setRunResults([]);
      return;
    }
    let cancelled = false;
    setRunSearchLoading(true);
    api
      .GET("/api/projects/{project_slug}/runs", {
        params: {
          path: { project_slug: projectSlug },
          query: { q: debouncedQuery } as Record<string, unknown>,
        },
      })
      .then(({ data }) => {
        if (cancelled) return;
        setRunResults((data as RunListPage | undefined)?.data ?? []);
      })
      .finally(() => {
        if (!cancelled) setRunSearchLoading(false);
      });
    return () => { cancelled = true; };
  }, [debouncedQuery, mode, projectSlug]);

  const { data, isLoading } = useSearch({
    slug: projectSlug,
    query: mode === "default" ? debouncedQuery : "",
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

  // --- Action handlers ---

  const handleCreateRun = () => {
    if (!projectSlug) return;
    navigate(`/p/${projectSlug}/runs/new`);
    onClose();
  };

  const handleOpenLatestRun = async () => {
    if (!projectSlug) return;
    setLatestRunLoading(true);
    try {
      // Check cache first
      const cached = qc.getQueryData<{ pages: Array<{ data: RunSummary[] }> }>(
        runKeys.list(projectSlug, {}),
      );
      const cachedFirst = cached?.pages?.[0]?.data?.[0];
      if (cachedFirst) {
        navigate(`/p/${projectSlug}/runs/${cachedFirst.id}`);
        onClose();
        return;
      }
      // Fetch one run
      const { data } = await api.GET("/api/projects/{project_slug}/runs", {
        params: { path: { project_slug: projectSlug }, query: {} },
      });
      const first = (data as RunListPage | undefined)?.data?.[0];
      if (first) {
        navigate(`/p/${projectSlug}/runs/${first.id}`);
        onClose();
      } else {
        // No runs — navigate to runs list (shows empty state)
        navigate(`/p/${projectSlug}/runs`);
        onClose();
      }
    } finally {
      setLatestRunLoading(false);
    }
  };

  const handleEnterJumpToRun = () => {
    setMode("jump-to-run");
    setInputValue("");
    setDebouncedQuery("");
  };

  const handleSelectRun = (run: RunSummary) => {
    if (!projectSlug) return;
    navigate(`/p/${projectSlug}/runs/${run.id}`);
    onClose();
  };

  const handleBack = () => {
    setMode("default");
    setInputValue("");
    setDebouncedQuery("");
    setRunResults([]);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // SP3.4 — Plans & Suites action handlers

  const handleEnterResolvePlan = () => {
    setMode("resolve-plan");
    setInputValue("");
    setDebouncedQuery("");
  };

  const handleSelectPlan = (plan: PlanSummary) => {
    if (!projectSlug) return;
    navigate(`/p/${projectSlug}/plans/${plan.wombat_id}`);
    onClose();
  };

  const handleNewPlan = () => {
    if (!projectSlug) return;
    navigate(`/p/${projectSlug}/plans/new`);
    onClose();
  };

  const handleNewSuite = () => {
    if (!projectSlug) return;
    navigate(`/p/${projectSlug}/suites/new`);
    onClose();
  };

  const handleOpenDashboard = () => {
    if (!projectSlug) return;
    navigate(`/p/${projectSlug}`);
    onClose();
  };

  const handleOpenPlans = () => {
    if (!projectSlug) return;
    navigate(`/p/${projectSlug}/plans`);
    onClose();
  };

  const handleOpenSuites = () => {
    if (!projectSlug) return;
    navigate(`/p/${projectSlug}/suites`);
    onClose();
  };

  if (!open) return null;

  const placeholder =
    mode === "jump-to-run"
      ? "Type a run title to search…"
      : mode === "resolve-plan"
        ? "Search plans…"
        : "Search testcases, shared steps, stories…";

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
            {mode === "jump-to-run" || mode === "resolve-plan" ? (
              <button
                type="button"
                aria-label="Back to commands"
                onClick={handleBack}
                className="shrink-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
                style={{ color: "var(--fg-muted)" }}
              >
                <MoveRight
                  className="h-4 w-4 rotate-180"
                  aria-hidden="true"
                />
              </button>
            ) : (
              <Search
                className="h-4 w-4 shrink-0"
                aria-hidden="true"
                style={{ color: "var(--fg-muted)" }}
              />
            )}

            {mode === "jump-to-run" && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                style={{
                  background: "var(--bg-surface-3)",
                  color: "var(--fg-muted)",
                  border: "1px solid var(--border-default)",
                }}
              >
                Jump to run
              </span>
            )}

            {mode === "resolve-plan" && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                style={{
                  background: "color-mix(in srgb, var(--chart-cat-3, #d97706) 12%, var(--bg-surface-3))",
                  color: "var(--chart-cat-3, #d97706)",
                  border: "1px solid color-mix(in srgb, var(--chart-cat-3, #d97706) 25%, var(--border-default))",
                }}
              >
                Resolve plan
              </span>
            )}

            <Command.Input
              ref={inputRef as RefObject<HTMLInputElement>}
              value={inputValue}
              onValueChange={setInputValue}
              placeholder={placeholder}
              className={cn(
                "flex-1 bg-transparent text-[13px] outline-none",
                "placeholder:text-[color:var(--fg-disabled)]",
              )}
              style={{ color: "var(--fg-default)" }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (mode === "jump-to-run" || mode === "resolve-plan") {
                    handleBack();
                  } else {
                    onClose();
                  }
                }
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
            {/* ---- RESOLVE-PLAN mode (SP3.4) ---- */}
            {mode === "resolve-plan" ? (
              plansLoading ? (
                <RunResultsSkeleton />
              ) : allPlans.length === 0 ? (
                <Command.Empty>
                  <div className="py-10 text-center">
                    <p
                      className="text-[13px]"
                      style={{ color: "var(--fg-muted)" }}
                    >
                      {debouncedQuery.length >= 2
                        ? `No plans match “${debouncedQuery}”`
                        : "No plans in this project"}
                    </p>
                  </div>
                </Command.Empty>
              ) : (
                <div className="p-2">
                  <Command.Group
                    heading={
                      <span
                        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider block"
                        style={{ color: "var(--fg-muted)" }}
                      >
                        Plans
                      </span>
                    }
                  >
                    {allPlans.map((plan) => (
                      <Command.Item
                        key={plan.wombat_id}
                        value={`plan ${plan.wombat_id} ${plan.title}`}
                        onSelect={() => handleSelectPlan(plan)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer",
                          "transition-colors duration-80 outline-none",
                          "data-[selected=true]:bg-[color:var(--accent-soft)]",
                        )}
                        style={{ color: "var(--fg-default)" }}
                      >
                        <ClipboardList
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                          style={{ color: "var(--chart-cat-3, #d97706)" }}
                        />
                        <span
                          className="font-mono text-[11px] font-semibold shrink-0"
                          style={{ color: "var(--chart-cat-3, #d97706)" }}
                        >
                          {plan.wombat_id}
                        </span>
                        <span
                          className="flex-1 min-w-0 truncate text-[13px]"
                          style={{ color: "var(--fg-default)" }}
                        >
                          {plan.title}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                </div>
              )
            ) : /* ---- JUMP-TO-RUN mode ---- */
            mode === "jump-to-run" ? (
              debouncedQuery.length < 2 ? (
                <Command.Empty>
                  <div
                    className="flex flex-col items-center gap-2 py-10 text-center"
                    style={{ color: "var(--fg-muted)" }}
                  >
                    <p className="text-[13px]">Type a run title to search…</p>
                  </div>
                </Command.Empty>
              ) : runSearchLoading ? (
                <RunResultsSkeleton />
              ) : runResults.length === 0 ? (
                <Command.Empty>
                  <div className="py-10 text-center">
                    <p
                      className="text-[13px]"
                      style={{ color: "var(--fg-muted)" }}
                    >
                      No runs match &ldquo;{debouncedQuery}&rdquo;
                    </p>
                  </div>
                </Command.Empty>
              ) : (
                <div className="p-2">
                  <Command.Group
                    heading={
                      <span
                        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider block"
                        style={{ color: "var(--fg-muted)" }}
                      >
                        Runs
                      </span>
                    }
                  >
                    {runResults.map((run) => (
                      <Command.Item
                        key={run.id}
                        value={`run ${run.id} ${run.title}`}
                        onSelect={() => handleSelectRun(run)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer",
                          "transition-colors duration-80 outline-none",
                          "data-[selected=true]:bg-[color:var(--accent-soft)]",
                        )}
                        style={{ color: "var(--fg-default)" }}
                      >
                        <PlayCircle
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                          style={{ color: "var(--result-not-run, var(--fg-muted))" }}
                        />
                        <span
                          className="flex-1 min-w-0 truncate text-[13px]"
                          style={{ color: "var(--fg-default)" }}
                        >
                          {run.title}
                        </span>
                        <RunStatusPill status={run.status} closeReason={run.close_reason} />
                      </Command.Item>
                    ))}
                  </Command.Group>
                </div>
              )
            ) : (
              /* ---- DEFAULT mode ---- */
              <>
                {/* Static run action commands — shown before search results */}
                {projectSlug && (
                  <div className="p-2 pb-0">
                    <Command.Group
                      heading={
                        <span
                          className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider block"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          Runs
                        </span>
                      }
                    >
                      <Command.Item
                        value="create run new test run"
                        onSelect={handleCreateRun}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer",
                          "transition-colors duration-80 outline-none",
                          "data-[selected=true]:bg-[color:var(--accent-soft)]",
                        )}
                        style={{ color: "var(--fg-default)" }}
                      >
                        <Rocket
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                          style={{ color: "var(--accent-fg)" }}
                        />
                        <span className="flex-1 text-[13px]">Create run</span>
                        <ActionHint>⌘ N</ActionHint>
                      </Command.Item>

                      <Command.Item
                        value="open latest run most recent"
                        onSelect={() => void handleOpenLatestRun()}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer",
                          "transition-colors duration-80 outline-none",
                          "data-[selected=true]:bg-[color:var(--accent-soft)]",
                        )}
                        style={{ color: "var(--fg-default)" }}
                      >
                        <PlayCircle
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                          style={{
                            color: latestRunLoading
                              ? "var(--fg-disabled)"
                              : "var(--accent-fg)",
                          }}
                        />
                        <span className="flex-1 text-[13px]">
                          {latestRunLoading ? "Loading…" : "Open latest run"}
                        </span>
                      </Command.Item>

                      <Command.Item
                        value="jump to run by title navigate find"
                        onSelect={handleEnterJumpToRun}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer",
                          "transition-colors duration-80 outline-none",
                          "data-[selected=true]:bg-[color:var(--accent-soft)]",
                        )}
                        style={{ color: "var(--fg-default)" }}
                      >
                        <MoveRight
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                          style={{ color: "var(--accent-fg)" }}
                        />
                        <span className="flex-1 text-[13px]">
                          Jump to run by title
                        </span>
                        <ActionHint>→</ActionHint>
                      </Command.Item>
                    </Command.Group>

                    {/* SP3.4 — Plans & Suites group */}
                    <Command.Group
                      heading={
                        <span
                          className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider block"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          Plans &amp; Suites
                        </span>
                      }
                    >
                      <Command.Item
                        value="open dashboard project overview"
                        onSelect={handleOpenDashboard}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer",
                          "transition-colors duration-80 outline-none",
                          "data-[selected=true]:bg-[color:var(--accent-soft)]",
                        )}
                        style={{ color: "var(--fg-default)" }}
                      >
                        <LayoutDashboard
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                          style={{ color: "var(--accent-fg)" }}
                        />
                        <span className="flex-1 text-[13px]">Open dashboard</span>
                      </Command.Item>

                      <Command.Item
                        value="open plans list all plans"
                        onSelect={handleOpenPlans}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer",
                          "transition-colors duration-80 outline-none",
                          "data-[selected=true]:bg-[color:var(--accent-soft)]",
                        )}
                        style={{ color: "var(--fg-default)" }}
                      >
                        <ClipboardList
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                          style={{ color: "var(--chart-cat-3, #d97706)" }}
                        />
                        <span className="flex-1 text-[13px]">Open plans</span>
                      </Command.Item>

                      <Command.Item
                        value="new plan create plan"
                        onSelect={handleNewPlan}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer",
                          "transition-colors duration-80 outline-none",
                          "data-[selected=true]:bg-[color:var(--accent-soft)]",
                        )}
                        style={{ color: "var(--fg-default)" }}
                      >
                        <ClipboardList
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                          style={{ color: "var(--chart-cat-3, #d97706)" }}
                        />
                        <span className="flex-1 text-[13px]">New plan</span>
                      </Command.Item>

                      <Command.Item
                        value="resolve plan cases navigate find plan"
                        onSelect={handleEnterResolvePlan}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer",
                          "transition-colors duration-80 outline-none",
                          "data-[selected=true]:bg-[color:var(--accent-soft)]",
                        )}
                        style={{ color: "var(--fg-default)" }}
                      >
                        <MoveRight
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                          style={{ color: "var(--chart-cat-3, #d97706)" }}
                        />
                        <span className="flex-1 text-[13px]">Resolve plan…</span>
                        <ActionHint>→</ActionHint>
                      </Command.Item>

                      <Command.Item
                        value="open suites list all suites"
                        onSelect={handleOpenSuites}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer",
                          "transition-colors duration-80 outline-none",
                          "data-[selected=true]:bg-[color:var(--accent-soft)]",
                        )}
                        style={{ color: "var(--fg-default)" }}
                      >
                        <Layers
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                          style={{ color: "var(--chart-cat-2, #0891b2)" }}
                        />
                        <span className="flex-1 text-[13px]">Open suites</span>
                      </Command.Item>

                      <Command.Item
                        value="new suite create suite"
                        onSelect={handleNewSuite}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-2.5 cursor-pointer",
                          "transition-colors duration-80 outline-none",
                          "data-[selected=true]:bg-[color:var(--accent-soft)]",
                        )}
                        style={{ color: "var(--fg-default)" }}
                      >
                        <Layers
                          className="h-3.5 w-3.5 shrink-0"
                          aria-hidden="true"
                          style={{ color: "var(--chart-cat-2, #0891b2)" }}
                        />
                        <span className="flex-1 text-[13px]">New suite</span>
                      </Command.Item>
                    </Command.Group>
                  </div>
                )}

                {/* Content search results */}
                {debouncedQuery.length < 2 ? (
                  /* Only show prompt if no project slug yet (no action group above), OR always show below actions */
                  !projectSlug ? (
                    <Command.Empty>
                      <div
                        className="flex flex-col items-center gap-2 py-10 text-center"
                        style={{ color: "var(--fg-muted)" }}
                      >
                        <p className="text-[13px]">Type to search…</p>
                        <p className="text-[11px]">
                          Testcases, shared steps, and stories
                        </p>
                      </div>
                    </Command.Empty>
                  ) : (
                    <div
                      className="px-7 pb-3 text-[11px]"
                      style={{ color: "var(--fg-disabled)" }}
                    >
                      Type to search testcases, shared steps, stories…
                    </div>
                  )
                ) : isLoading ? (
                  <div className="flex flex-col gap-1 p-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded-md px-3 py-2.5"
                        style={{ background: "var(--bg-surface-2)" }}
                      >
                        <div
                          className="h-3.5 w-3.5 rounded animate-pulse"
                          style={{ background: "var(--bg-surface-3)" }}
                        />
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
                      <p
                        className="text-[13px]"
                        style={{ color: "var(--fg-muted)" }}
                      >
                        No results for &ldquo;{debouncedQuery}&rdquo;
                      </p>
                    </div>
                  </Command.Empty>
                ) : (
                  <div className="p-2 pt-0">
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
              </>
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
              <kbd
                className="rounded px-1 py-0.5 font-mono"
                style={{
                  background: "var(--bg-surface-3)",
                  border: "1px solid var(--border-default)",
                }}
              >
                ↑↓
              </kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd
                className="rounded px-1 py-0.5 font-mono"
                style={{
                  background: "var(--bg-surface-3)",
                  border: "1px solid var(--border-default)",
                }}
              >
                ↵
              </kbd>
              {mode === "jump-to-run"
                ? "open run"
                : mode === "resolve-plan"
                  ? "open plan"
                  : "open"}
            </span>
            {(mode === "jump-to-run" || mode === "resolve-plan") && (
              <span className="flex items-center gap-1">
                <kbd
                  className="rounded px-1 py-0.5 font-mono"
                  style={{
                    background: "var(--bg-surface-3)",
                    border: "1px solid var(--border-default)",
                  }}
                >
                  Esc
                </kbd>
                back
              </span>
            )}
            {mode === "default" && (
              <span className="flex items-center gap-1">
                <kbd
                  className="rounded px-1 py-0.5 font-mono"
                  style={{
                    background: "var(--bg-surface-3)",
                    border: "1px solid var(--border-default)",
                  }}
                >
                  Esc
                </kbd>
                close
              </span>
            )}
          </div>
        </Command>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                     */
/* ------------------------------------------------------------------ */

function ActionHint({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]"
      style={{
        background: "var(--bg-surface-3)",
        color: "var(--fg-disabled)",
        border: "1px solid var(--border-default)",
      }}
    >
      {children}
    </kbd>
  );
}

function RunStatusPill({
  status,
  closeReason,
}: {
  status: RunSummary["status"];
  closeReason: RunSummary["close_reason"];
}) {
  const label =
    status === "open"
      ? "open"
      : closeReason === "aborted"
        ? "aborted"
        : "closed";

  const color =
    status === "open"
      ? "var(--feedback-success-fg, #22c55e)"
      : "var(--fg-muted)";

  return (
    <span
      className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
      style={{
        background: "var(--bg-surface-3)",
        color,
        border: "1px solid var(--border-subtle)",
      }}
    >
      {label}
    </span>
  );
}

function RunResultsSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-md px-3 py-2.5"
          style={{ background: "var(--bg-surface-2)" }}
        >
          <div
            className="h-3.5 w-3.5 rounded animate-pulse"
            style={{ background: "var(--bg-surface-3)" }}
          />
          <div
            className="h-3 rounded animate-pulse"
            style={{
              background: "var(--bg-surface-3)",
              width: `${50 + (i % 3) * 12}%`,
            }}
          />
        </div>
      ))}
    </div>
  );
}
