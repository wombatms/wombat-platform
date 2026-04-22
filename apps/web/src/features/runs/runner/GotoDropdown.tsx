/**
 * GotoDropdown — keyboard-triggered dropdown to jump to any case by position
 * or wombat_id within the current run.
 *
 * Opened by the `g g` chord in useRunnerKeyboard, or by clicking the "Go to"
 * button in the FocusMode top strip.
 *
 * Design: a floating popover with a filter input + virtualised list of cases.
 * The input auto-focuses on open. Keyboard: ↑/↓ navigate, Enter jumps, Esc closes.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunCase } from "../hooks/runs";

interface GotoDropdownProps {
  open: boolean;
  onClose: () => void;
  cases: RunCase[];
  currentCaseId: string | null;
  onSelect: (caseId: string) => void;
}

export function GotoDropdown({
  open,
  onClose,
  cases,
  currentCaseId,
  onSelect,
}: GotoDropdownProps) {
  const [query, setQuery] = useState("");
  const [highlightedIdx, setHighlightedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = cases.filter(
    (c) =>
      !query ||
      c.title.toLowerCase().includes(query.toLowerCase()) ||
      c.wombat_id.toLowerCase().includes(query.toLowerCase()),
  );

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scroll highlighted item into view
  useEffect(() => {
    const item = listRef.current?.children[highlightedIdx] as
      | HTMLElement
      | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightedIdx]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = filtered[highlightedIdx];
      if (chosen) {
        onSelect(chosen.wombat_id);
        onClose();
      }
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Popover */}
      <div
        role="dialog"
        aria-label="Go to case"
        className="fixed left-1/2 top-16 z-50 w-[420px] -translate-x-1/2 rounded-xl overflow-hidden shadow-2xl"
        style={{
          background: "var(--bg-surface-1)",
          border: "1px solid var(--border-strong)",
        }}
      >
        {/* Filter input */}
        <div
          className="flex items-center gap-2 px-3 py-2.5 border-b"
          style={{ borderColor: "var(--border-default)" }}
        >
          <ArrowUpDown
            className="h-4 w-4 shrink-0"
            aria-hidden="true"
            style={{ color: "var(--fg-muted)" }}
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightedIdx(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search by title or ID…"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--fg-default)" }}
            aria-label="Filter cases"
            aria-autocomplete="list"
            aria-controls="goto-case-list"
            aria-activedescendant={
              filtered[highlightedIdx]
                ? `goto-item-${filtered[highlightedIdx].wombat_id}`
                : undefined
            }
          />
          <kbd
            className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{
              background: "var(--bg-surface-2)",
              border: "1px solid var(--border-default)",
              color: "var(--fg-muted)",
            }}
          >
            Esc
          </kbd>
        </div>

        {/* List */}
        <div
          id="goto-case-list"
          ref={listRef}
          role="listbox"
          aria-label="Cases"
          className="max-h-72 overflow-y-auto py-1"
        >
          {filtered.length === 0 ? (
            <p
              className="px-4 py-5 text-sm text-center"
              style={{ color: "var(--fg-muted)" }}
            >
              No cases match "{query}"
            </p>
          ) : (
            filtered.map((c, idx) => {
              const isCurrent = c.wombat_id === currentCaseId;
              const isHighlighted = idx === highlightedIdx;
              return (
                <div
                  key={c.wombat_id}
                  id={`goto-item-${c.wombat_id}`}
                  role="option"
                  aria-selected={isCurrent}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 cursor-pointer text-sm",
                    "transition-colors duration-75",
                  )}
                  style={{
                    background: isHighlighted
                      ? "var(--bg-surface-2)"
                      : "transparent",
                    color: "var(--fg-default)",
                  }}
                  onMouseEnter={() => setHighlightedIdx(idx)}
                  onClick={() => {
                    onSelect(c.wombat_id);
                    onClose();
                  }}
                >
                  <span
                    className="text-[11px] font-mono shrink-0 w-5 text-right"
                    style={{ color: "var(--fg-disabled)" }}
                  >
                    {c.position}
                  </span>
                  <span
                    className="font-mono text-[11px] shrink-0"
                    style={{
                      color: isCurrent
                        ? "var(--accent-primary)"
                        : "var(--fg-muted)",
                    }}
                  >
                    {c.wombat_id}
                  </span>
                  <span className="flex-1 min-w-0 truncate">{c.title}</span>
                  {isCurrent && (
                    <span
                      className="text-[10px] font-medium shrink-0"
                      style={{ color: "var(--accent-primary)" }}
                    >
                      current
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div
          className="flex items-center gap-3 px-4 py-2 border-t text-[11px]"
          style={{
            borderColor: "var(--border-subtle)",
            color: "var(--fg-disabled)",
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ jump</span>
          <span>Esc cancel</span>
        </div>
      </div>
    </>
  );
}
