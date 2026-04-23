/**
 * MetadataFields — kind-switched metadata section for ContentBuilder (SP3.4 §5.3).
 *
 * Design decisions from frontend-design skill (Task 41):
 * - "Coherent document form" aesthetic: each field group has generous vertical
 *   rhythm; sections feel like distinct paragraphs of a form document.
 * - Collapsible "Advanced" section uses CSS grid-rows animation (0fr → 1fr)
 *   for smooth height expand without JS layout measurement.
 * - Collapsed state shows a summary row: "2 assignees · 1 approval" so users
 *   can scan what's inside without opening.
 * - Plan fields: environments multi-select (useEnvironments), release string.
 *   Advanced: assignees (free-text chips), approvals (free-text chips).
 * - Suite fields: parent picker typeahead (useSuiteTree), owner string, tags chips.
 * - useEnvironments is imported from the existing SP3.3 hook.
 *   TODO(sp3.4-followup): if the environments list is empty and no
 *   /environments endpoint exists in the API yet, the multi-select gracefully
 *   falls back to a free-text input (checked via data.length === 0 + isSuccess).
 * - Parent picker for suite: same typeahead pattern as SuiteRefsPicker but
 *   single-select (picks one parent); clears with a X button on the chip.
 */

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from "react";
import { ChevronDown, X, Search, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnvironments } from "@/features/runs/hooks/environments";
import { useSuiteTree } from "@/features/suites/hooks";
import { useParams } from "react-router-dom";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanMetadata {
  environments: string[];   // environment IDs
  release: string;
  assignees: string[];      // free-text handles e.g. "@qa-team"
  approvals: string[];      // free-text handles e.g. "@qa-lead"
}

export interface SuiteMetadata {
  parent_wombat_id: string | null;
  owner: string;
  tags: string[];
}

export interface MetadataFieldsProps {
  kind: "plan" | "suite";
  planMeta?: PlanMetadata;
  suiteMeta?: SuiteMetadata;
  onChangePlan?: (patch: Partial<PlanMetadata>) => void;
  onChangeSuite?: (patch: Partial<SuiteMetadata>) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
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
// FreeTextChipList — handle-style chip input (assignees, approvals, tags)
// ---------------------------------------------------------------------------

interface FreeTextChipListProps {
  values: string[];
  onAdd: (v: string) => void;
  onRemove: (v: string) => void;
  placeholder?: string;
  inputId: string;
  ariaLabel: string;
}

function FreeTextChipList({ values, onAdd, onRemove, placeholder, inputId, ariaLabel }: FreeTextChipListProps) {
  const [inputVal, setInputVal] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback(() => {
    const trimmed = inputVal.trim();
    if (trimmed && !values.includes(trimmed)) {
      onAdd(trimmed);
    }
    setInputVal("");
    setIsEditing(false);
  }, [inputVal, values, onAdd]);

  return (
    <div className="flex flex-wrap gap-1.5 items-center min-h-[28px]" role="list" aria-label={ariaLabel}>
      {values.map((v) => (
        <span
          key={v}
          role="listitem"
          className="inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded text-xs"
          style={{
            background: "var(--bg-surface-3)",
            color: "var(--fg-default)",
            border: "1px solid var(--border-default)",
            fontFamily: v.startsWith("@") ? "monospace" : undefined,
          }}
        >
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => onRemove(v)}
            className="rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
            style={{ color: "var(--fg-muted)" }}
          >
            <X className="h-2.5 w-2.5" aria-hidden="true" />
          </button>
        </span>
      ))}

      {isEditing ? (
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { setInputVal(""); setIsEditing(false); }
            else if (e.key === "Backspace" && inputVal === "" && values.length > 0) {
              const last = values[values.length - 1];
              if (last !== undefined) onRemove(last);
            }
          }}
          onBlur={commit}
          placeholder={placeholder ?? "Add…"}
          aria-label={ariaLabel}
          className="rounded px-1.5 py-0.5 text-xs outline-none min-w-[80px]"
          style={{
            background: "var(--bg-surface-1)",
            border: "1px solid var(--accent-primary)",
            color: "var(--fg-default)",
          }}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      ) : (
        <button
          type="button"
          onClick={() => { setIsEditing(true); setTimeout(() => inputRef.current?.focus(), 0); }}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] border border-dashed transition-all outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
          style={{ borderColor: "var(--border-strong)", color: "var(--fg-disabled)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent-primary)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--accent-fg)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-strong)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--fg-disabled)";
          }}
        >
          + {placeholder ?? "Add"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EnvironmentMultiSelect — uses useEnvironments; falls back to free-text
// ---------------------------------------------------------------------------

interface EnvironmentMultiSelectProps {
  selected: string[];   // env IDs
  onChange: (ids: string[]) => void;
}

function EnvironmentMultiSelect({ selected, onChange }: EnvironmentMultiSelectProps) {
  const { slug = "" } = useParams<{ slug: string }>();
  const { data: envs = [], isSuccess } = useEnvironments(slug);

  const toggle = useCallback((id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  }, [selected, onChange]);

  // Fallback: no envs from API → free-text
  if (isSuccess && envs.length === 0) {
    return (
      <div>
        <FreeTextChipList
          values={selected}
          onAdd={(v) => onChange([...selected, v])}
          onRemove={(v) => onChange(selected.filter((s) => s !== v))}
          placeholder="staging, prod-eu…"
          inputId="env-freetext-input"
          ariaLabel="Environments (free-text)"
        />
        <p className="mt-1 text-[10px]" style={{ color: "var(--fg-disabled)" }}>
          {/* TODO(sp3.4-followup): environment picker once /environments endpoint populates */}
          No environments configured — type names directly.
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="group"
      aria-label="Select environments"
    >
      {envs.map((env) => {
        const isSelected = selected.includes(env.id);
        return (
          <button
            key={env.id}
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            onClick={() => toggle(env.id)}
            className={cn(
              "px-2.5 py-1 rounded text-xs font-medium transition-all outline-none",
              "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-offset-1",
            )}
            style={{
              background: isSelected ? "var(--accent-soft)" : "var(--bg-surface-2)",
              color: isSelected ? "var(--accent-fg)" : "var(--fg-muted)",
              border: isSelected
                ? "1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent)"
                : "1px solid var(--border-default)",
            }}
          >
            {env.name}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ParentPicker — single-select suite typeahead for suite kind
// ---------------------------------------------------------------------------

interface ParentPickerProps {
  value: string | null;
  onChange: (wid: string | null) => void;
  currentWid?: string;   // exclude self from the list (edit mode)
}

function ParentPicker({ value, onChange, currentWid }: ParentPickerProps) {
  const { slug = "" } = useParams<{ slug: string }>();
  const { data: flatNodes = [] } = useSuiteTree(slug);

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useOutsideClick(containerRef, () => setIsOpen(false));

  const selectedNode = value ? flatNodes.find((n) => n.wombat_id === value) : null;

  const filtered = flatNodes
    .filter((n) => n.wombat_id !== currentWid && n.wombat_id !== value)
    .filter((n) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return n.title.toLowerCase().includes(q) || n.wombat_id.toLowerCase().includes(q);
    })
    .slice(0, 8);

  const select = useCallback((wid: string) => {
    onChange(wid);
    setQuery("");
    setIsOpen(false);
    setFocusedIndex(-1);
  }, [onChange]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") { setIsOpen(true); setFocusedIndex(0); }
      return;
    }
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); setFocusedIndex((i) => Math.min(i + 1, filtered.length - 1)); break;
      case "ArrowUp": e.preventDefault(); setFocusedIndex((i) => Math.max(i - 1, 0)); break;
      case "Enter":
        e.preventDefault();
        if (focusedIndex >= 0) { const n = filtered[focusedIndex]; if (n) select(n.wombat_id); }
        break;
      case "Escape": setIsOpen(false); setFocusedIndex(-1); break;
    }
  }, [isOpen, filtered, focusedIndex, select]);

  if (value && selectedNode) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded text-xs"
          style={{
            background: "var(--feedback-warn-bg)",
            color: "var(--feedback-warn-fg)",
            border: "1px solid color-mix(in srgb, var(--feedback-warn-fg) 20%, transparent)",
          }}
        >
          <GitBranch className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
          <span className="font-medium truncate max-w-[180px]">{selectedNode.title}</span>
          <span className="font-mono text-[10px] ml-0.5" style={{ opacity: 0.7 }}>
            {selectedNode.wombat_id}
          </span>
          <button
            type="button"
            aria-label="Clear parent suite"
            onClick={() => onChange(null)}
            className="ml-0.5 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
            style={{ color: "var(--feedback-warn-fg)" }}
          >
            <X className="h-2.5 w-2.5" aria-hidden="true" />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
        style={{
          background: "var(--bg-surface-1)",
          border: `1px solid ${isOpen ? "var(--accent-primary)" : "var(--border-default)"}`,
        }}
      >
        <Search className="h-3 w-3 shrink-0" aria-hidden="true" style={{ color: "var(--fg-muted)" }} />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="parent-picker-listbox"
          aria-autocomplete="list"
          aria-label="Search parent suite"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIsOpen(true); setFocusedIndex(0); }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search parent suite…"
          className="flex-1 text-xs bg-transparent outline-none"
          style={{ color: "var(--fg-default)" }}
        />
      </div>
      {isOpen && (
        <div
          id="parent-picker-listbox"
          role="listbox"
          aria-label="Parent suite suggestions"
          className="absolute z-50 w-full mt-1 rounded-md overflow-y-auto"
          style={{
            background: "var(--bg-surface-1)",
            border: "1px solid var(--border-default)",
            boxShadow: "var(--shadow-md)",
            maxHeight: 200,
            top: "100%",
          }}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-center" style={{ color: "var(--fg-disabled)" }}>
              {flatNodes.length === 0 ? "No suites yet" : "No matching suites"}
            </div>
          ) : (
            filtered.map((n, i) => (
              <button
                key={n.wombat_id}
                type="button"
                role="option"
                aria-selected={i === focusedIndex}
                onMouseDown={(e) => { e.preventDefault(); select(n.wombat_id); }}
                onMouseEnter={() => setFocusedIndex(i)}
                className="w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors"
                style={{ background: i === focusedIndex ? "var(--sel-row)" : "transparent" }}
              >
                <span className="text-xs font-medium truncate w-full" style={{ color: "var(--fg-default)" }}>{n.title}</span>
                <span className="text-[10px] font-mono" style={{ color: "var(--fg-muted)" }}>{n.wombat_id}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdvancedSection — collapsible disclosure with grid-rows CSS animation
// ---------------------------------------------------------------------------

interface AdvancedSectionProps {
  summary: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function AdvancedSection({ summary, children, defaultOpen = false }: AdvancedSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      className="rounded-md overflow-hidden"
      style={{
        border: "1px solid var(--border-subtle)",
        background: "var(--bg-surface-2)",
      }}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2.5 text-left",
          "transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-inset",
        )}
        style={{ background: "transparent" }}
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            isOpen && "rotate-180",
          )}
          aria-hidden="true"
          style={{ color: "var(--fg-muted)" }}
        />
        <span className="text-xs font-semibold" style={{ color: "var(--fg-default)" }}>
          Advanced
        </span>
        {!isOpen && summary && (
          <span
            className="ml-auto text-[11px] truncate"
            style={{ color: "var(--fg-muted)" }}
          >
            {summary}
          </span>
        )}
      </button>

      {/* CSS grid-rows animation: 0fr → 1fr */}
      <div
        className="grid transition-all duration-200 ease-in-out"
        style={{
          gridTemplateRows: isOpen ? "1fr" : "0fr",
        }}
      >
        <div className="overflow-hidden">
          <div
            className="px-3 pb-4 pt-1 flex flex-col gap-4"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field — labelled form field wrapper
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, htmlFor, hint, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {htmlFor ? (
        <label
          htmlFor={htmlFor}
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--fg-muted)" }}
        >
          {label}
        </label>
      ) : (
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--fg-muted)" }}
        >
          {label}
        </span>
      )}
      {children}
      {hint && (
        <p className="text-[11px]" style={{ color: "var(--fg-disabled)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StringInput — simple controlled text input
// ---------------------------------------------------------------------------

function StringInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      id={id}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "w-full rounded-md px-3 py-1.5 text-xs",
        "border outline-none transition-all",
        "focus:ring-2 focus:ring-[color:var(--focus-ring)] focus:ring-offset-1",
      )}
      style={{
        background: "var(--bg-surface-1)",
        border: "1px solid var(--border-default)",
        color: "var(--fg-default)",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// MetadataFields — exported component
// ---------------------------------------------------------------------------

/**
 * MetadataFields — kind-switched metadata section.
 *
 * Plan: environments (multi-select toggle buttons, falls back to free-text
 * if no envs configured), release string, + Advanced (assignees, approvals).
 *
 * Suite: parent picker (typeahead, single-select), owner string, tags chips.
 */
export function MetadataFields({
  kind,
  planMeta,
  suiteMeta,
  onChangePlan,
  onChangeSuite,
  className,
}: MetadataFieldsProps) {
  // Build Advanced section summary for collapsed state
  const advancedSummary = (() => {
    if (kind !== "plan" || !planMeta) return "";
    const parts: string[] = [];
    if (planMeta.assignees.length > 0) {
      parts.push(`${planMeta.assignees.length} ${planMeta.assignees.length === 1 ? "assignee" : "assignees"}`);
    }
    if (planMeta.approvals.length > 0) {
      parts.push(`${planMeta.approvals.length} ${planMeta.approvals.length === 1 ? "approval" : "approvals"}`);
    }
    return parts.join(" · ");
  })();

  if (kind === "plan") {
    const meta = planMeta ?? { environments: [], release: "", assignees: [], approvals: [] };
    const update = (patch: Partial<PlanMetadata>) => onChangePlan?.(patch);

    return (
      <section aria-label="Plan metadata" className={cn("flex flex-col gap-5", className)}>
        {/* Section header */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
            Plan settings
          </span>
          <div className="flex-1 h-px" style={{ background: "var(--border-subtle)" }} aria-hidden="true" />
        </div>

        {/* Environments */}
        <Field label="Environments" hint="Select one or more environments for this plan's runs.">
          <EnvironmentMultiSelect
            selected={meta.environments}
            onChange={(environments) => update({ environments })}
          />
        </Field>

        {/* Release */}
        <Field label="Release" htmlFor="meta-release" hint="e.g. 2026.05 or v3.1.0">
          <StringInput
            id="meta-release"
            value={meta.release}
            onChange={(release) => update({ release })}
            placeholder="2026.05"
          />
        </Field>

        {/* Advanced: Assignees + Approvals */}
        <AdvancedSection
          summary={advancedSummary || "Assignees, approvals"}
          defaultOpen={meta.assignees.length > 0 || meta.approvals.length > 0}
        >
          <Field label="Assignees" hint="@handles who will execute this plan's runs.">
            <FreeTextChipList
              values={meta.assignees}
              onAdd={(v) => update({ assignees: [...meta.assignees, v] })}
              onRemove={(v) => update({ assignees: meta.assignees.filter((a) => a !== v) })}
              placeholder="@qa-team"
              inputId="meta-assignees-input"
              ariaLabel="Assignees"
            />
          </Field>

          <Field label="Required approvals" hint="@handles who must approve this plan.">
            <FreeTextChipList
              values={meta.approvals}
              onAdd={(v) => update({ approvals: [...meta.approvals, v] })}
              onRemove={(v) => update({ approvals: meta.approvals.filter((a) => a !== v) })}
              placeholder="@qa-lead"
              inputId="meta-approvals-input"
              ariaLabel="Required approvals"
            />
          </Field>
        </AdvancedSection>
      </section>
    );
  }

  // Suite kind
  const meta = suiteMeta ?? { parent_wombat_id: null, owner: "", tags: [] };
  const update = (patch: Partial<SuiteMetadata>) => onChangeSuite?.(patch);

  return (
    <section aria-label="Suite metadata" className={cn("flex flex-col gap-5", className)}>
      {/* Section header */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
          Suite settings
        </span>
        <div className="flex-1 h-px" style={{ background: "var(--border-subtle)" }} aria-hidden="true" />
      </div>

      {/* Parent suite */}
      <Field label="Parent suite" hint="Optional. Places this suite under a parent in the tree.">
        <ParentPicker
          value={meta.parent_wombat_id}
          onChange={(wid) => update({ parent_wombat_id: wid })}
        />
      </Field>

      {/* Owner */}
      <Field label="Owner" htmlFor="meta-owner" hint="@handle of the responsible team or person.">
        <StringInput
          id="meta-owner"
          value={meta.owner}
          onChange={(owner) => update({ owner })}
          placeholder="@qa-team"
        />
      </Field>

      {/* Tags */}
      <Field label="Tags">
        <FreeTextChipList
          values={meta.tags}
          onAdd={(v) => update({ tags: [...meta.tags, v] })}
          onRemove={(v) => update({ tags: meta.tags.filter((t) => t !== v) })}
          placeholder="regression, smoke…"
          inputId="meta-tags-input"
          ariaLabel="Suite tags"
        />
      </Field>
    </section>
  );
}
