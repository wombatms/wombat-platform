/**
 * CaseSelector.LibraryTab — pre-populated from URL param `?ids=TC-001,TC-002`.
 *
 * Shows the pre-selected cases as editable checkboxes. Users can deselect
 * individual items. The full list is fetched on mount so we show titles,
 * not just bare IDs.
 *
 * When no `?ids=` param is present, shows a helpful empty state explaining
 * how to arrive at this tab via the Library page.
 */

import { useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, CheckSquare, Square } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useTestcaseList } from "@/features/library/useTestcaseList";
import type { Testcase } from "@/features/library/useTestcaseList";
import { cn } from "@/lib/utils";

interface LibraryTabProps {
  projectSlug: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectIds: (ids: string[]) => void;
}

export function LibraryTab({
  projectSlug,
  selected,
  onToggle,
  onSelectIds,
}: LibraryTabProps) {
  const [searchParams] = useSearchParams();

  // Parse `?ids=TC-001,TC-002` from the URL
  const idsParam = searchParams.get("ids");
  const preSelectedIds: string[] = useMemo(() => {
    if (!idsParam) return [];
    return idsParam
      .split(",")
      .map((id) => id.trim().toUpperCase())
      .filter(Boolean);
  }, [idsParam]);

  const hasPreSelected = preSelectedIds.length > 0;

  // Seed selected set on mount when ids param is present
  // We track whether we've seeded to avoid duplicate calls
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (hasPreSelected && !seeded) {
      onSelectIds(preSelectedIds);
      setSeeded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPreSelected, seeded]);

  // Fetch testcase details for the pre-selected IDs.
  // We fetch a generous limit and filter client-side; for large projects
  // this is acceptable because the library list is already cached.
  const { data, isLoading } = useTestcaseList(projectSlug, { limit: 500 });
  const allRows: Testcase[] = data?.data ?? [];

  // Only show rows that were in the original pre-selected set
  const relevantRows = allRows.filter((r) =>
    preSelectedIds.includes(r.wombat_id.toUpperCase()),
  );

  // For IDs not yet resolved (API still loading or not found), show stubs
  const resolvedIds = new Set(relevantRows.map((r) => r.wombat_id.toUpperCase()));
  const unresolvedIds = preSelectedIds.filter((id) => !resolvedIds.has(id));

  if (!hasPreSelected) {
    return <LibraryTabEmpty projectSlug={projectSlug} />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-2.5 border-b text-xs"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--bg-surface-2)",
        }}
      >
        <span style={{ color: "var(--fg-muted)" }}>
          <span
            className="font-semibold tabular-nums"
            style={{ color: "var(--fg-default)" }}
          >
            {preSelectedIds.length}
          </span>{" "}
          {preSelectedIds.length === 1 ? "case" : "cases"} from Library
          {selected.size > 0 && (
            <span style={{ color: "var(--accent-fg)" }}>
              {" "}
              · {[...preSelectedIds].filter((id) => selected.has(id)).length}{" "}
              selected
            </span>
          )}
        </span>
        <Link
          to={`/p/${projectSlug}/library`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "inline-flex items-center gap-1 rounded text-xs",
            "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
          )}
          style={{ color: "var(--accent-fg)" }}
        >
          Open Library
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>

      {/* Case list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <LibraryTabSkeleton count={preSelectedIds.length} />
        ) : (
          <ul role="list" aria-label="Pre-selected cases from library">
            {relevantRows.map((tc) => (
              <LibraryCaseRow
                key={tc.wombat_id}
                tc={tc}
                checked={selected.has(tc.wombat_id)}
                onToggle={() => onToggle(tc.wombat_id)}
              />
            ))}
            {unresolvedIds.map((id) => (
              <UnresolvedRow key={id} id={id} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LibraryCaseRow
// ---------------------------------------------------------------------------

interface LibraryCaseRowProps {
  tc: Testcase;
  checked: boolean;
  onToggle: () => void;
}

function LibraryCaseRow({ tc, checked, onToggle }: LibraryCaseRowProps) {
  return (
    <li>
      <label
        className={cn(
          "flex cursor-pointer items-center gap-3 px-4 py-2.5 border-b",
          "transition-colors duration-100",
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
            border: checked ? "none" : "2px solid var(--border-strong)",
            transition: "background 0.1s, border 0.1s",
          }}
        >
          {checked ? (
            <CheckSquare
              className="h-4 w-4 text-white"
              aria-hidden="true"
              strokeWidth={2.5}
            />
          ) : (
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
// UnresolvedRow — shown for IDs not yet found in the API response
// ---------------------------------------------------------------------------

function UnresolvedRow({ id }: { id: string }) {
  return (
    <li
      className="flex items-center gap-3 px-4 py-2.5 border-b"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
        style={{ border: "2px solid var(--border-strong)" }}
        aria-hidden="true"
      />
      <span
        className="font-mono text-[11px] font-semibold"
        style={{ color: "var(--fg-muted)" }}
      >
        {id}
      </span>
      <span
        className="text-[10px] italic"
        style={{ color: "var(--fg-muted)" }}
      >
        not found
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// LibraryTabEmpty — no ids param
// ---------------------------------------------------------------------------

function LibraryTabEmpty({ projectSlug }: { projectSlug: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10 px-6 text-center">
      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl"
        style={{ background: "var(--bg-surface-2)" }}
      >
        <BookOpen
          className="h-5 w-5"
          aria-hidden="true"
          style={{ color: "var(--fg-muted)" }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <p
          className="text-sm font-semibold"
          style={{ color: "var(--fg-default)" }}
        >
          No cases pre-selected
        </p>
        <p className="text-xs leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          To pre-populate this tab, select cases in the Library and use the
          "Add to new run" bulk action, or navigate here with{" "}
          <code className="font-mono text-[10px]">?ids=TC-001,TC-002</code> in
          the URL.
        </p>
      </div>
      <Link
        to={`/p/${projectSlug}/library`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
          "transition-colors duration-150",
          "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
        )}
        style={{
          background: "var(--bg-surface-2)",
          border: "1px solid var(--border-default)",
          color: "var(--fg-default)",
        }}
      >
        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
        Open Library
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LibraryTabSkeleton
// ---------------------------------------------------------------------------

function LibraryTabSkeleton({ count }: { count: number }) {
  return (
    <div aria-busy="true" aria-label="Loading pre-selected cases">
      {Array.from({ length: Math.min(count, 8) }).map((_, i) => (
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
                width: `${45 + (i % 4) * 10}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
