import type { ChangeEvent, KeyboardEvent } from "react";
import { useId, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Density } from "./PageHeader";

export interface FacetValue {
  key: string;
  value: string;
}

export interface FacetBarProps {
  values: FacetValue[];
  available: string[];
  onChange: (next: FacetValue[]) => void;
  density?: Density;
  className?: string;
}

/**
 * FacetBar — horizontal row of active filter pills + "add filter" trigger.
 *
 * Controlled: parent owns `values`; `onChange` fires with the full next array.
 *
 * Keyboard:
 * - Tab moves focus through pills and the add-filter button.
 * - Enter/Space on a pill's × button removes it.
 * - The add-filter popover is navigable by keyboard via the Select + Input.
 */
export function FacetBar({
  values,
  available,
  onChange,
  density = "comfortable",
  className,
}: FacetBarProps) {
  const isCompact = density === "compact";

  const removeFacet = (idx: number) => {
    onChange(values.filter((_, i) => i !== idx));
  };

  return (
    <div
      role="group"
      aria-label="Active filters"
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        isCompact ? "px-4 py-1.5" : "px-5 py-2",
        className,
      )}
    >
      {values.map((fv, idx) => (
        <FacetPill
          key={`${fv.key}:${fv.value}:${idx}`}
          facetKey={fv.key}
          facetValue={fv.value}
          onRemove={() => removeFacet(idx)}
          compact={isCompact}
        />
      ))}

      <AddFilterButton
        available={available}
        onAdd={(fv) => onChange([...values, fv])}
        compact={isCompact}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FacetPill                                                            */
/* ------------------------------------------------------------------ */

interface FacetPillProps {
  facetKey: string;
  facetValue: string;
  onRemove: () => void;
  compact: boolean;
}

function FacetPill({ facetKey, facetValue, onRemove, compact }: FacetPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-mono text-[11px] leading-none",
        compact ? "h-5 pl-2 pr-0.5" : "h-6 pl-2.5 pr-0.5",
      )}
      style={{
        background: "var(--accent-soft)",
        border: "1px solid var(--border-default)",
        color: "var(--fg-default)",
      }}
    >
      {/* Facet key — muted label */}
      <span
        className="shrink-0 uppercase tracking-wider"
        style={{ color: "var(--fg-muted)", fontSize: "10px" }}
      >
        {facetKey}
      </span>
      {/* Divider */}
      <span aria-hidden="true" style={{ color: "var(--border-strong)" }}>:</span>
      {/* Facet value — prominent */}
      <span
        className="max-w-[120px] truncate font-semibold"
        style={{ color: "var(--accent-fg)" }}
      >
        {facetValue}
      </span>
      {/* Remove button */}
      <button
        type="button"
        aria-label={`Remove filter ${facetKey}: ${facetValue}`}
        onClick={onRemove}
        className={cn(
          "ml-0.5 flex items-center justify-center rounded-full transition-colors duration-120",
          "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
          compact ? "h-4 w-4" : "h-4 w-4",
        )}
        style={{ color: "var(--fg-muted)" }}
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
  );
}

/* ------------------------------------------------------------------ */
/* AddFilterButton + popover                                            */
/* ------------------------------------------------------------------ */

interface AddFilterButtonProps {
  available: string[];
  onAdd: (fv: FacetValue) => void;
  compact: boolean;
}

function AddFilterButton({ available, onAdd, compact }: AddFilterButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const reset = () => {
    setSelectedKey("");
    setInputValue("");
  };

  const handleAdd = () => {
    const key = selectedKey.trim();
    const val = inputValue.trim();
    if (!key || !val) return;
    onAdd({ key, value: val });
    reset();
    setOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
    if (e.key === "Escape") {
      setOpen(false);
      reset();
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
        else {
          // Focus input once popover is open
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Add filter"
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            "inline-flex items-center gap-1 rounded-full font-mono text-[11px] leading-none",
            "transition-colors duration-120 outline-none",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
            compact ? "h-5 px-2" : "h-6 px-2.5",
          )}
          style={{
            border: "1.5px dashed var(--border-strong)",
            color: "var(--fg-muted)",
            background: "transparent",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent-primary)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--accent-fg)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-strong)";
            (e.currentTarget as HTMLButtonElement).style.color = "var(--fg-muted)";
          }}
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Add filter
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-64 p-3"
        role="dialog"
        aria-label="Add filter"
      >
        <div className="flex flex-col gap-2">
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-0.5"
            style={{ color: "var(--fg-muted)" }}
          >
            Add filter
          </p>

          {/* Facet key selector — native select for full a11y + jsdom compatibility */}
          <select
            value={selectedKey}
            aria-label="Filter field"
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setSelectedKey(e.target.value);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className={cn(
              "h-8 w-full rounded-md border px-2 text-xs outline-none",
              "transition-[border-color,box-shadow] duration-120",
              "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]/30",
              "focus-visible:border-[color:var(--focus-ring)]",
              "appearance-none cursor-pointer",
            )}
            style={{
              background: "var(--bg-surface-1)",
              border: "1px solid var(--border-default)",
              color: selectedKey ? "var(--fg-default)" : "var(--fg-muted)",
            }}
          >
            <option value="" disabled>
              Choose field…
            </option>
            {available.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>

          {/* Facet value input */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor={inputId}
              className="text-[10px] uppercase tracking-wider"
              style={{ color: "var(--fg-muted)" }}
            >
              Value
            </label>
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter value…"
              disabled={!selectedKey}
              className={cn(
                "h-8 w-full rounded-md border px-3 text-xs outline-none",
                "transition-[border-color,box-shadow] duration-120",
                "disabled:cursor-not-allowed disabled:opacity-50",
                "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]/30",
                "focus-visible:border-[color:var(--focus-ring)]",
                "placeholder:text-[color:var(--fg-disabled)]",
              )}
              style={{
                background: "var(--bg-surface-1)",
                border: "1px solid var(--border-default)",
                color: "var(--fg-default)",
              }}
              aria-describedby={selectedKey ? undefined : "facet-key-hint"}
            />
            {!selectedKey && (
              <p
                id="facet-key-hint"
                className="text-[10px]"
                style={{ color: "var(--fg-disabled)" }}
              >
                Select a field first
              </p>
            )}
          </div>

          {/* Apply / Cancel */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={!selectedKey || !inputValue.trim()}
              onClick={handleAdd}
            >
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
