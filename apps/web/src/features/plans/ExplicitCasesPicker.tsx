/**
 * ExplicitCasesPicker — typeahead for explicit case adds/removes (SP3.4 §5.3).
 *
 * Design decisions from frontend-design skill (Task 40):
 * - Same typeahead-with-chips pattern as SuiteRefsPicker.
 * - Two sections below the input: "Add" and "Remove".
 * - "Add" chips: cases the user has explicitly added (green badge).
 * - "Remove" chips: cases marked for removal — can be set here OR via the
 *   PreviewPane's inline Remove button. Chips in this section show in
 *   feedback-error tones (red) to signal exclusion.
 * - Typeahead calls useTestcaseList with a debounced `q` param.
 * - Dropdown items: title + wombat_id secondary.
 * - Both `add` and `remove` lists sync bidirectionally with ContentBuilder.
 *
 * NOTE: The remove section mirrors ContentBuilder's explicit_cases.remove,
 * which is ALSO written by the PreviewPane's inline Remove button. Both
 * pathways produce the same mutations; this component is the form-side control.
 *
 * TODO(sp3.4-followup): if useTestcaseList endpoint returns more than 100
 * results, add cursor-based pagination to the dropdown (the hook already
 * supports `limit` + `offset` params).
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type KeyboardEvent,
} from "react";
import { Search, X, FileText, Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTestcaseList } from "@/features/library/useTestcaseList";
import type { Testcase } from "@/features/library/useTestcaseList";
import { useParams } from "react-router-dom";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExplicitCasesPickerProps {
  /** Cases to explicitly add */
  addIds: string[];
  /** Cases to explicitly remove (may also be set by PreviewPane) */
  removeIds: string[];
  onChangeAdd: (ids: string[]) => void;
  onChangeRemove: (ids: string[]) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// useOutsideClick
// ---------------------------------------------------------------------------

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
  tc: Testcase;
  isFocused: boolean;
  onSelect: () => void;
  onFocus: () => void;
}

function DropdownItem({ tc, isFocused, onSelect, onFocus }: DropdownItemProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isFocused}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      onMouseEnter={onFocus}
      className="w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors outline-none"
      style={{
        background: isFocused ? "var(--sel-row)" : "transparent",
      }}
    >
      <span
        className="text-xs font-medium truncate w-full"
        style={{ color: "var(--fg-default)" }}
      >
        {tc.title}
      </span>
      <span
        className="text-[10px] font-mono"
        style={{ color: "var(--fg-muted)" }}
      >
        {tc.wombat_id}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// CaseChip — used in both Add and Remove sections
// ---------------------------------------------------------------------------

interface CaseChipProps {
  wombatId: string;
  title?: string;
  variant: "add" | "remove";
  onRemove: () => void;
}

function CaseChip({ wombatId, title, variant, onRemove }: CaseChipProps) {
  const isAdd = variant === "add";
  const fgVar = isAdd ? "--feedback-success-fg" : "--feedback-error-fg";
  const bgVar = isAdd ? "--feedback-success-bg" : "--feedback-error-bg";

  return (
    <span
      title={title}
      className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded"
      style={{
        background: `var(${bgVar})`,
        color: `var(${fgVar})`,
        border: `1px solid color-mix(in srgb, var(${fgVar}) 20%, transparent)`,
      }}
    >
      {isAdd
        ? <Plus className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
        : <Minus className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      }
      <span className="text-[10px] font-mono font-semibold">{wombatId}</span>
      <button
        type="button"
        aria-label={`${isAdd ? "Remove from add list" : "Restore"}: ${wombatId}`}
        onClick={onRemove}
        className="rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)] ml-0.5"
        style={{ color: `var(${fgVar})` }}
      >
        <X className="h-2.5 w-2.5" aria-hidden="true" />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// SectionLabel — small section header pill
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
      style={{
        background: "var(--bg-surface-2)",
        color: "var(--fg-muted)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ExplicitCasesPicker
// ---------------------------------------------------------------------------

const MAX_DROPDOWN_ITEMS = 8;

export function ExplicitCasesPicker({
  addIds,
  removeIds,
  onChangeAdd,
  onChangeRemove,
  className,
}: ExplicitCasesPickerProps) {
  const { slug = "" } = useParams<{ slug: string }>();

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [mode, setMode] = useState<"add" | "remove">("add");

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedQuery = useDebounce(query, 200);

  useOutsideClick(containerRef, () => setIsOpen(false));

  // Fetch testcases matching the debounced query
  const { data: listData, isLoading } = useTestcaseList(slug, {
    q: debouncedQuery || undefined,
    limit: MAX_DROPDOWN_ITEMS,
    offset: 0,
  });

  // Exclude already-added cases from dropdown
  const filtered = useMemo(() => {
    const allResults: Testcase[] = listData?.data ?? [];
    return allResults.filter((tc) => !addIds.includes(tc.wombat_id));
  }, [listData?.data, addIds]);

  const selectCase = useCallback((tc: Testcase) => {
    if (mode === "add") {
      if (!addIds.includes(tc.wombat_id)) {
        onChangeAdd([...addIds, tc.wombat_id]);
        // If this case was in the remove list, lift it out
        if (removeIds.includes(tc.wombat_id)) {
          onChangeRemove(removeIds.filter((id) => id !== tc.wombat_id));
        }
      }
    } else {
      if (!removeIds.includes(tc.wombat_id)) {
        onChangeRemove([...removeIds, tc.wombat_id]);
        // If this case was in the add list, lift it out
        if (addIds.includes(tc.wombat_id)) {
          onChangeAdd(addIds.filter((id) => id !== tc.wombat_id));
        }
      }
    }
    setQuery("");
    setFocusedIndex(-1);
    setIsOpen(false);
    inputRef.current?.focus();
  }, [mode, addIds, removeIds, onChangeAdd, onChangeRemove]);

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
          const tc = filtered[focusedIndex];
          if (tc) selectCase(tc);
        }
        break;
      case "Escape":
        setIsOpen(false);
        setFocusedIndex(-1);
        break;
    }
  }, [isOpen, filtered, focusedIndex, selectCase]);

  const hasContent = addIds.length > 0 || removeIds.length > 0;

  return (
    <section aria-label="Explicit cases" className={cn("flex flex-col gap-2", className)}>
      {/* Section header */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--fg-muted)" }}
        >
          Explicit cases
        </span>
        <div className="flex-1 h-px" style={{ background: "var(--border-subtle)" }} aria-hidden="true" />
        {hasContent && (
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
            style={{ background: "var(--bg-surface-2)", color: "var(--fg-muted)" }}
          >
            {addIds.length + removeIds.length}
          </span>
        )}
      </div>

      {/* Mode toggle: Add / Remove */}
      <div
        className="inline-flex rounded-md overflow-hidden self-start"
        style={{ border: "1px solid var(--border-default)" }}
        role="group"
        aria-label="Add or remove explicit cases"
      >
        {(["add", "remove"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className="px-3 py-1 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-inset"
            style={{
              background: mode === m
                ? m === "add" ? "var(--feedback-success-bg)" : "var(--feedback-error-bg)"
                : "var(--bg-surface-1)",
              color: mode === m
                ? m === "add" ? "var(--feedback-success-fg)" : "var(--feedback-error-fg)"
                : "var(--fg-muted)",
              borderRight: m === "add" ? "1px solid var(--border-default)" : undefined,
            }}
          >
            {m === "add" ? "+ Add" : "– Remove"}
          </button>
        ))}
      </div>

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
            aria-autocomplete="list"
            aria-label={mode === "add" ? "Search cases to add" : "Search cases to remove"}
            aria-controls="explicit-cases-listbox"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
              setFocusedIndex(0);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={
              isLoading
                ? "Loading…"
                : mode === "add"
                  ? "Search cases to add…"
                  : "Search cases to remove…"
            }
            className="flex-1 text-xs bg-transparent outline-none"
            style={{ color: "var(--fg-default)" }}
          />
          <FileText
            className="h-3 w-3 shrink-0"
            aria-hidden="true"
            style={{
              color: mode === "add" ? "var(--feedback-success-fg)" : "var(--feedback-error-fg)",
              opacity: 0.6,
            }}
          />
        </div>

        {/* Dropdown */}
        {isOpen && (
          <div
            id="explicit-cases-listbox"
            role="listbox"
            aria-label="Case suggestions"
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
            {isLoading ? (
              <div className="px-3 py-3 text-xs" style={{ color: "var(--fg-disabled)" }}>
                Searching…
              </div>
            ) : filtered.length === 0 ? (
              <div
                className="px-3 py-4 text-center text-xs"
                style={{ color: "var(--fg-disabled)" }}
              >
                {query ? "No matching cases" : "Start typing to search"}
              </div>
            ) : (
              filtered.map((tc, i) => (
                <DropdownItem
                  key={tc.wombat_id}
                  tc={tc}
                  isFocused={i === focusedIndex}
                  onSelect={() => selectCase(tc)}
                  onFocus={() => setFocusedIndex(i)}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Add chips */}
      {addIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Added</SectionLabel>
          <div className="flex flex-wrap gap-1.5" role="list" aria-label="Explicitly added cases">
            {addIds.map((wid) => (
              <span key={wid} role="listitem">
                <CaseChip
                  wombatId={wid}
                  variant="add"
                  onRemove={() => onChangeAdd(addIds.filter((id) => id !== wid))}
                />
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Remove chips */}
      {removeIds.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SectionLabel>Removed</SectionLabel>
          <div className="flex flex-wrap gap-1.5" role="list" aria-label="Explicitly removed cases">
            {removeIds.map((wid) => (
              <span key={wid} role="listitem">
                <CaseChip
                  wombatId={wid}
                  variant="remove"
                  onRemove={() => onChangeRemove(removeIds.filter((id) => id !== wid))}
                />
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
