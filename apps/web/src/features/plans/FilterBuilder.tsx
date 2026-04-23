/**
 * FilterBuilder — include / exclude filter UI for ContentBuilder (SP3.4 §5.3).
 *
 * Design decisions from frontend-design skill (Task 39):
 * - Two-column layout: Include (left) / Exclude (right) separated by a thin
 *   vertical divider colored `var(--border-strong)`. Small dot marker in the
 *   group's accent color (Include = accent-primary, Exclude = feedback-error-fg)
 *   differentiates groups beyond text.
 * - Tags: chip-with-X list. "+ Add tag" reveals an inline <input> after existing
 *   chips; pressing Enter or comma commits the tag; Escape cancels; Backspace on
 *   empty input removes the last chip.
 * - Priorities: P0..P4 toggle-button pills (aria-pressed). Selecting/deselecting
 *   updates the `priorities` array. Non-color indicator: "P0" label is inherently
 *   legible; selected state uses a filled background + checkmark icon.
 * - Components: free-text typeahead. For MVP, free-text only (no
 *   /projects/:slug/components endpoint available). Tagged TODO for SP3.5.
 *   TODO(sp3.4-followup): replace free-text with typeahead once
 *   GET /api/projects/{slug}/components endpoint ships.
 *
 * Accessibility:
 * - Chip X buttons have aria-label="Remove tag <name>".
 * - Priority pills use role="group" with aria-label scoped to Include/Exclude.
 * - Tag input has a visually-hidden label.
 */

import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import { X, Plus, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FilterGroup {
  tags_any: string[];
  /** Comma-separated priority values, e.g. ["P0", "P1", "P2"]. */
  priorities: string[];
  components_any: string[];
  // tags_all is not exposed in the UI (advanced use case); preserved in body.
  tags_all?: string[];
}

export interface FilterBuilderProps {
  include: FilterGroup;
  exclude: FilterGroup;
  onChange: (patch: { include?: Partial<FilterGroup>; exclude?: Partial<FilterGroup> }) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Priority options
// ---------------------------------------------------------------------------

const PRIORITIES = ["P0", "P1", "P2", "P3", "P4"] as const;
type Priority = (typeof PRIORITIES)[number];

// ---------------------------------------------------------------------------
// TagChipList — inline chip list with add affordance
// ---------------------------------------------------------------------------

interface TagChipListProps {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  inputId: string;
  inputLabel: string;
}

function TagChipList({ tags, onAdd, onRemove, inputId, inputLabel }: TagChipListProps) {
  const [inputValue, setInputValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitTag = useCallback(() => {
    const trimmed = inputValue.trim().replace(/,$/, "");
    if (trimmed && !tags.includes(trimmed)) {
      onAdd(trimmed);
    }
    setInputValue("");
  }, [inputValue, tags, onAdd]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTag();
    } else if (e.key === "Escape") {
      setInputValue("");
      setIsAdding(false);
    } else if (e.key === "Backspace" && inputValue === "" && tags.length > 0) {
      const lastTag = tags[tags.length - 1];
      if (lastTag !== undefined) onRemove(lastTag);
    }
  }, [commitTag, inputValue, tags, onRemove]);

  return (
    <div
      className="flex flex-wrap gap-1 min-h-[28px] items-center"
      role="list"
      aria-label={inputLabel}
    >
      {/* Existing tag chips */}
      {tags.map((tag) => (
        <span
          key={tag}
          role="listitem"
          className="inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded text-xs font-medium"
          style={{
            background: "var(--bg-surface-3)",
            color: "var(--fg-default)",
            border: "1px solid var(--border-default)",
          }}
        >
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={() => onRemove(tag)}
            className={cn(
              "rounded-sm flex items-center justify-center",
              "outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
              "transition-colors",
            )}
            style={{
              width: 14,
              height: 14,
              color: "var(--fg-muted)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--feedback-error-fg)";
              (e.currentTarget as HTMLButtonElement).style.background = "var(--feedback-error-bg)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--fg-muted)";
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            <X className="h-2.5 w-2.5" aria-hidden="true" />
          </button>
        </span>
      ))}

      {/* Add button or inline input */}
      {isAdding ? (
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            commitTag();
            setIsAdding(false);
          }}
          placeholder="tag name…"
          aria-label={inputLabel}
          className="rounded px-1.5 py-0.5 text-xs outline-none min-w-[80px] max-w-[140px]"
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
          onClick={() => {
            setIsAdding(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className={cn(
            "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px]",
            "border border-dashed",
            "transition-all outline-none",
            "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
          )}
          style={{
            borderColor: "var(--border-strong)",
            color: "var(--fg-disabled)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent-primary)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--accent-fg)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-strong)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--fg-disabled)";
          }}
        >
          <Plus className="h-2.5 w-2.5" aria-hidden="true" />
          Add tag
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PriorityPills — toggle buttons for P0..P4
// ---------------------------------------------------------------------------

interface PriorityPillsProps {
  selected: string[];
  onChange: (priorities: string[]) => void;
  groupLabel: string;
}

// Priority visual weight: P0 = most critical (error tone), P4 = lowest (muted)
const PRIORITY_STYLES: Record<Priority, { selected: { bg: string; fg: string; border: string }; idle: { bg: string; fg: string; border: string } }> = {
  P0: {
    selected: { bg: "var(--feedback-error-bg)", fg: "var(--feedback-error-fg)", border: "var(--feedback-error-fg)" },
    idle: { bg: "transparent", fg: "var(--fg-muted)", border: "var(--border-default)" },
  },
  P1: {
    selected: { bg: "var(--feedback-warn-bg)", fg: "var(--feedback-warn-fg)", border: "var(--feedback-warn-fg)" },
    idle: { bg: "transparent", fg: "var(--fg-muted)", border: "var(--border-default)" },
  },
  P2: {
    selected: { bg: "var(--accent-soft)", fg: "var(--accent-fg)", border: "var(--accent-primary)" },
    idle: { bg: "transparent", fg: "var(--fg-muted)", border: "var(--border-default)" },
  },
  P3: {
    selected: { bg: "var(--feedback-success-bg)", fg: "var(--feedback-success-fg)", border: "var(--feedback-success-fg)" },
    idle: { bg: "transparent", fg: "var(--fg-muted)", border: "var(--border-default)" },
  },
  P4: {
    selected: { bg: "var(--bg-surface-3)", fg: "var(--fg-muted)", border: "var(--border-strong)" },
    idle: { bg: "transparent", fg: "var(--fg-disabled)", border: "var(--border-subtle)" },
  },
};

function PriorityPills({ selected, onChange, groupLabel }: PriorityPillsProps) {
  const toggle = (p: Priority) => {
    if (selected.includes(p)) {
      onChange(selected.filter((s) => s !== p));
    } else {
      onChange([...selected, p]);
    }
  };

  return (
    <div
      role="group"
      aria-label={`${groupLabel} priorities`}
      className="flex flex-wrap gap-1"
    >
      {PRIORITIES.map((p) => {
        const isSelected = selected.includes(p);
        const styles = PRIORITY_STYLES[p];
        const s = isSelected ? styles.selected : styles.idle;

        return (
          <button
            key={p}
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            onClick={() => toggle(p)}
            className={cn(
              "inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[11px] font-semibold",
              "transition-all outline-none",
              "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-offset-1",
            )}
            style={{
              background: s.bg,
              color: s.fg,
              border: `1px solid ${s.border}`,
            }}
          >
            {isSelected && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
            {p}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ComponentsInput — free-text with chip list
// TODO(sp3.4-followup): replace with typeahead when GET /api/projects/{slug}/components ships.
// ---------------------------------------------------------------------------

interface ComponentsInputProps {
  components: string[];
  onAdd: (c: string) => void;
  onRemove: (c: string) => void;
  inputId: string;
}

function ComponentsInput({ components, onAdd, onRemove, inputId }: ComponentsInputProps) {
  const [value, setValue] = useState("");

  const commit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed && !components.includes(trimmed)) {
      onAdd(trimmed);
    }
    setValue("");
  }, [value, components, onAdd]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { setValue(""); }
            else if (e.key === "Backspace" && value === "" && components.length > 0) {
              const last = components[components.length - 1];
              if (last !== undefined) onRemove(last);
            }
          }}
          onBlur={commit}
          placeholder="component name…"
          className="flex-1 rounded px-2 py-1 text-xs outline-none"
          style={{
            background: "var(--bg-surface-1)",
            border: "1px solid var(--border-default)",
            color: "var(--fg-default)",
          }}
          // free-text fallback — TODO(sp3.4-followup): add typeahead dropdown here
        />
      </div>
      {components.length > 0 && (
        <div className="flex flex-wrap gap-1" role="list" aria-label="Selected components">
          {components.map((c) => (
            <span
              key={c}
              role="listitem"
              className="inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded text-[11px]"
              style={{
                background: "var(--bg-surface-3)",
                color: "var(--fg-default)",
                border: "1px solid var(--border-default)",
              }}
            >
              {c}
              <button
                type="button"
                aria-label={`Remove component ${c}`}
                onClick={() => onRemove(c)}
                className="rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
                style={{ color: "var(--fg-muted)" }}
              >
                <X className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterGroup — one Include or Exclude column
// ---------------------------------------------------------------------------

interface FilterGroupColumnProps {
  kind: "include" | "exclude";
  value: FilterGroup;
  onChange: (patch: Partial<FilterGroup>) => void;
}

function FilterGroupColumn({ kind, value, onChange }: FilterGroupColumnProps) {
  const isInclude = kind === "include";
  const dotColor = isInclude ? "var(--accent-primary)" : "var(--feedback-error-fg)";
  const headingColor = isInclude ? "var(--accent-fg)" : "var(--feedback-error-fg)";
  const labelPrefix = isInclude ? "Include" : "Exclude";

  const addTag = useCallback((tag: string) => {
    onChange({ tags_any: [...value.tags_any, tag] });
  }, [value.tags_any, onChange]);

  const removeTag = useCallback((tag: string) => {
    onChange({ tags_any: value.tags_any.filter((t) => t !== tag) });
  }, [value.tags_any, onChange]);

  const addComponent = useCallback((c: string) => {
    onChange({ components_any: [...value.components_any, c] });
  }, [value.components_any, onChange]);

  const removeComponent = useCallback((c: string) => {
    onChange({ components_any: value.components_any.filter((x) => x !== c) });
  }, [value.components_any, onChange]);

  return (
    <div className="flex flex-col gap-4 min-w-0">
      {/* Group heading with dot marker */}
      <div className="flex items-center gap-1.5">
        <span
          className="inline-block rounded-full shrink-0"
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            background: dotColor,
          }}
        />
        <h3
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: headingColor }}
        >
          {labelPrefix}
        </h3>
      </div>

      {/* Tags row */}
      <div className="flex flex-col gap-1">
        <span
          className="text-[11px] font-medium"
          style={{ color: "var(--fg-muted)" }}
        >
          Tags
        </span>
        <TagChipList
          tags={value.tags_any}
          onAdd={addTag}
          onRemove={removeTag}
          inputId={`${kind}-tags-input`}
          inputLabel={`${labelPrefix} tags`}
        />
      </div>

      {/* Priorities row */}
      <div className="flex flex-col gap-1">
        <span
          className="text-[11px] font-medium"
          style={{ color: "var(--fg-muted)" }}
        >
          Priorities
        </span>
        <PriorityPills
          selected={value.priorities}
          onChange={(priorities) => onChange({ priorities })}
          groupLabel={labelPrefix}
        />
      </div>

      {/* Components row */}
      <div className="flex flex-col gap-1">
        <label
          htmlFor={`${kind}-components-input`}
          className="text-[11px] font-medium"
          style={{ color: "var(--fg-muted)" }}
        >
          Components
          {/* MVP: free-text input; typeahead deferred */}
          <span
            className="ml-1.5 text-[10px] font-normal"
            style={{ color: "var(--fg-disabled)" }}
          >
            (free-text)
          </span>
        </label>
        <ComponentsInput
          components={value.components_any}
          onAdd={addComponent}
          onRemove={removeComponent}
          inputId={`${kind}-components-input`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterBuilder — exported component
// ---------------------------------------------------------------------------

/**
 * FilterBuilder — two-column include/exclude filter builder.
 *
 * Used inside ContentBuilder's FormPane for both plan and suite (both have
 * include/exclude filter bodies).
 *
 * onChange emits patches to either the include or exclude sub-object.
 * The parent (ContentBuilder) merges them into the body.
 */
export function FilterBuilder({ include, exclude, onChange, className }: FilterBuilderProps) {
  const handleIncludeChange = useCallback((patch: Partial<FilterGroup>) => {
    onChange({ include: patch });
  }, [onChange]);

  const handleExcludeChange = useCallback((patch: Partial<FilterGroup>) => {
    onChange({ exclude: patch });
  }, [onChange]);

  return (
    <section
      aria-label="Case filters"
      className={cn("flex flex-col gap-3", className)}
    >
      {/* Section label */}
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--fg-muted)" }}
        >
          Filters
        </span>
        <div
          className="flex-1 h-px"
          style={{ background: "var(--border-subtle)" }}
          aria-hidden="true"
        />
      </div>

      {/* Two-column grid with vertical divider */}
      <div className="grid grid-cols-2 gap-0 relative">
        {/* Include column */}
        <div className="pr-5">
          <FilterGroupColumn
            kind="include"
            value={include}
            onChange={handleIncludeChange}
          />
        </div>

        {/* Vertical divider */}
        <div
          className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px"
          aria-hidden="true"
          style={{ background: "var(--border-strong)" }}
        />

        {/* Exclude column */}
        <div className="pl-5">
          <FilterGroupColumn
            kind="exclude"
            value={exclude}
            onChange={handleExcludeChange}
          />
        </div>
      </div>
    </section>
  );
}
