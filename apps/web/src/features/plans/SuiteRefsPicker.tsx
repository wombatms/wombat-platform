/**
 * SuiteRefsPicker — typeahead-with-chips suite reference picker (SP3.4 §5.3).
 *
 * Design decisions from frontend-design skill (Task 40):
 * - Typeahead input opens a floating dropdown with var(--shadow-md) card.
 * - Client-side filter: useSuiteTree(slug) fetches the flat node list;
 *   buildTree is not called here — we only need search over flat nodes.
 * - Each dropdown item: title (primary) + wombat_id in monospace (secondary).
 * - Arrow-key navigation + Enter selects; Escape closes dropdown.
 * - Chips below the input show title (truncated) + wombat_id. X removes.
 * - Already-selected suites are excluded from the dropdown results.
 * - Keyboard-first: focus trap is NOT applied (it's inline form, not modal).
 * - Empty query = show all suites (capped at 8 for density).
 * - Max-height 260px scrollable dropdown.
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent,
} from "react";
import { Search, X, Layers, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSuiteTree } from "@/features/suites/hooks";
import type { FlatNode } from "@/features/suites/hooks";
import { useParams } from "react-router-dom";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SuiteRefsPickerProps {
  /** Currently selected suite wombat_ids */
  value: string[];
  onChange: (suiteRefs: string[]) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Shared typeahead primitives
// ---------------------------------------------------------------------------

/** Close dropdown when clicking outside the container. */
function useOutsideClick(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onClose]);
}

// ---------------------------------------------------------------------------
// DropdownItem
// ---------------------------------------------------------------------------

interface DropdownItemProps {
  title: string;
  wombatId: string;
  isFocused: boolean;
  onSelect: () => void;
  onFocus: () => void;
}

function DropdownItem({ title, wombatId, isFocused, onSelect, onFocus }: DropdownItemProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isFocused}
      onMouseDown={(e) => {
        // Prevent the input from blurring before we handle the click
        e.preventDefault();
        onSelect();
      }}
      onMouseEnter={onFocus}
      className={cn(
        "w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left",
        "transition-colors outline-none",
      )}
      style={{
        background: isFocused ? "var(--sel-row)" : "transparent",
      }}
    >
      <span
        className="text-xs font-medium truncate w-full"
        style={{ color: "var(--fg-default)" }}
      >
        {title}
      </span>
      <span
        className="text-[10px] font-mono"
        style={{ color: "var(--fg-muted)" }}
      >
        {wombatId}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// SuiteChip
// ---------------------------------------------------------------------------

interface SuiteChipProps {
  title: string;
  wombatId: string;
  onRemove: () => void;
}

function SuiteChip({ title, wombatId, onRemove }: SuiteChipProps) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded"
      style={{
        background: "var(--feedback-info-bg)",
        color: "var(--feedback-info-fg)",
        border: "1px solid color-mix(in srgb, var(--feedback-info-fg) 20%, transparent)",
      }}
    >
      <Layers className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      <span className="text-[10px] font-mono font-semibold">{wombatId}</span>
      <button
        type="button"
        aria-label={`Remove suite ${title}`}
        onClick={onRemove}
        className="rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] ml-0.5"
        style={{ color: "var(--feedback-info-fg)" }}
      >
        <X className="h-2.5 w-2.5" aria-hidden="true" />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// SuiteRefsPicker
// ---------------------------------------------------------------------------

const MAX_DROPDOWN_ITEMS = 8;

export function SuiteRefsPicker({ value, onChange, className }: SuiteRefsPickerProps) {
  const { slug = "" } = useParams<{ slug: string }>();
  const { data: flatNodes = [], isLoading } = useSuiteTree(slug);

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useOutsideClick(containerRef, () => setIsOpen(false));

  // Client-side filter: exclude already-selected; match query in title or wombat_id
  const filtered = flatNodes
    .filter((n) => !value.includes(n.wombat_id))
    .filter((n) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return n.title.toLowerCase().includes(q) || n.wombat_id.toLowerCase().includes(q);
    })
    .slice(0, MAX_DROPDOWN_ITEMS);

  // Build a map for O(1) node lookup by wombat_id
  const nodeMap = new Map<string, FlatNode>(flatNodes.map((n) => [n.wombat_id, n]));

  const selectSuite = useCallback((wombatId: string) => {
    if (!value.includes(wombatId)) {
      onChange([...value, wombatId]);
    }
    setQuery("");
    setFocusedIndex(-1);
    setIsOpen(false);
    inputRef.current?.focus();
  }, [value, onChange]);

  const removeSuite = useCallback((wombatId: string) => {
    onChange(value.filter((id) => id !== wombatId));
  }, [value, onChange]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setIsOpen(true);
        setFocusedIndex(0);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, filtered.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filtered.length) {
          const node = filtered[focusedIndex];
          if (node) selectSuite(node.wombat_id);
        }
        break;
      case "Escape":
        setIsOpen(false);
        setFocusedIndex(-1);
        break;
      case "Backspace":
        if (query === "" && value.length > 0) {
          const lastId = value[value.length - 1];
          if (lastId) removeSuite(lastId);
        }
        break;
    }
  }, [isOpen, filtered, focusedIndex, query, value, selectSuite, removeSuite]);

  return (
    <section aria-label="Suite references" className={cn("flex flex-col gap-2", className)}>
      {/* Section header */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--fg-muted)" }}
        >
          Suite references
        </span>
        <div className="flex-1 h-px" style={{ background: "var(--border-subtle)" }} aria-hidden="true" />
        {value.length > 0 && (
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
            style={{ background: "var(--feedback-info-bg)", color: "var(--feedback-info-fg)" }}
          >
            {value.length}
          </span>
        )}
      </div>

      {/* Chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="list" aria-label="Selected suites">
          {value.map((wid) => {
            const node = nodeMap.get(wid);
            return (
              <span key={wid} role="listitem">
                <SuiteChip
                  title={node?.title ?? wid}
                  wombatId={wid}
                  onRemove={() => removeSuite(wid)}
                />
              </span>
            );
          })}
        </div>
      )}

      {/* Typeahead input */}
      <div ref={containerRef} className="relative">
        <div
          className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
          style={{
            background: "var(--bg-surface-1)",
            border: `1px solid ${isOpen ? "var(--accent-primary)" : "var(--border-default)"}`,
          }}
        >
          <Search
            className="h-3 w-3 shrink-0"
            aria-hidden="true"
            style={{ color: "var(--fg-muted)" }}
          />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={isOpen}
            aria-controls="suite-refs-listbox"
            aria-autocomplete="list"
            aria-label="Search suites"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
              setFocusedIndex(0);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? "Loading suites…" : "Search suites…"}
            disabled={isLoading}
            className="flex-1 text-xs bg-transparent outline-none"
            style={{ color: "var(--fg-default)" }}
          />
          {isOpen && (
            <ChevronDown
              className="h-3 w-3 shrink-0 rotate-180 transition-transform"
              aria-hidden="true"
              style={{ color: "var(--fg-muted)" }}
            />
          )}
        </div>

        {/* Dropdown */}
        {isOpen && (
          <div
            id="suite-refs-listbox"
            role="listbox"
            aria-label="Suite suggestions"
            className="absolute z-50 w-full mt-1 rounded-md overflow-hidden overflow-y-auto"
            style={{
              background: "var(--bg-surface-1)",
              border: "1px solid var(--border-default)",
              boxShadow: "var(--shadow-md)",
              maxHeight: 260,
              top: "100%",
              left: 0,
            }}
          >
            {filtered.length === 0 ? (
              <div
                className="px-3 py-4 text-center text-xs"
                style={{ color: "var(--fg-disabled)" }}
              >
                {flatNodes.length === 0
                  ? "No suites in this project yet"
                  : "No matching suites"}
              </div>
            ) : (
              filtered.map((node, i) => (
                <DropdownItem
                  key={node.wombat_id}
                  title={node.title}
                  wombatId={node.wombat_id}
                  isFocused={i === focusedIndex}
                  onSelect={() => selectSuite(node.wombat_id)}
                  onFocus={() => setFocusedIndex(i)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
