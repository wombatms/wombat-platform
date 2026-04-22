/**
 * CaseSelector.PasteTab — paste/type wombat IDs to add to a run.
 *
 * The user pastes comma/newline/space-separated IDs (e.g. TC-001, TC-002).
 * On "Validate", we fetch each via the testcase-list endpoint and report
 * which IDs were found vs. missing.
 *
 * Found IDs are added to the shared selected set. Missing IDs are shown
 * inline as error chips so the user can correct them.
 */

import { useCallback, useId, useRef, useState } from "react";
import {
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  ClipboardPaste,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface PasteTabProps {
  projectSlug: string;
  selected: Set<string>;
  onSelectIds: (ids: string[]) => void;
  onDeselectIds: (ids: string[]) => void;
}

type ValidationStatus = "idle" | "validating" | "done";

interface ValidationResult {
  found: string[];
  missing: string[];
}

// ---------------------------------------------------------------------------
// Parse raw text into a deduplicated list of IDs
// ---------------------------------------------------------------------------
function parseIds(raw: string): string[] {
  const normalized = raw.replace(/[\n,;\t]+/g, " ");
  const parts = normalized
    .split(/\s+/)
    .map((p) => p.trim().toUpperCase())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

// ---------------------------------------------------------------------------
// Validate IDs against the API
// ---------------------------------------------------------------------------
async function validateIds(
  projectSlug: string,
  ids: string[],
): Promise<ValidationResult> {
  if (ids.length === 0) return { found: [], missing: [] };

  // Fetch matching testcases. We query each batch using the search endpoint
  // (q=) or fall back to the testcase-list endpoint filtered by wombat_id.
  // Since there's no batch-lookup endpoint, we fetch the full list and
  // compare client-side. For large projects this is acceptable since the
  // list is already cached by TanStack Query via useTestcaseList.
  const found: string[] = [];
  const missing: string[] = [];

  // Fetch up to 500 results to cover typical project sizes
  const { data, error } = await api.GET(
    "/api/projects/{project_slug}/testcases",
    {
      params: {
        path: { project_slug: projectSlug },
        query: { limit: 500, offset: 0 },
      },
    },
  );

  if (error) throw error;

  const allRows = (
    data as { data?: Array<{ wombat_id: string }> }
  ).data ?? [];

  const knownIds = new Set(allRows.map((r) => r.wombat_id.toUpperCase()));

  for (const id of ids) {
    if (knownIds.has(id)) {
      found.push(id);
    } else {
      missing.push(id);
    }
  }

  return { found, missing };
}

// ---------------------------------------------------------------------------
// PasteTab component
// ---------------------------------------------------------------------------

export function PasteTab({
  projectSlug,
  selected,
  onSelectIds,
  onDeselectIds,
}: PasteTabProps) {
  const [raw, setRaw] = useState("");
  const [status, setStatus] = useState<ValidationStatus>("idle");
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();

  const parsedIds = parseIds(raw);
  const canValidate = parsedIds.length > 0;

  const handleValidate = useCallback(async () => {
    if (!canValidate) return;
    setStatus("validating");
    setResult(null);
    setValidateError(null);
    try {
      const r = await validateIds(projectSlug, parsedIds);
      setResult(r);
      setStatus("done");
      // Immediately mark found IDs as selected
      if (r.found.length > 0) {
        onSelectIds(r.found);
      }
    } catch (err) {
      setStatus("idle");
      setValidateError(
        err instanceof Error ? err.message : "Validation failed.",
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug, raw, canValidate, onSelectIds]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Allow Ctrl/Cmd+Enter to trigger validate
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleValidate();
    }
  };

  const handleClear = () => {
    setRaw("");
    setResult(null);
    setStatus("idle");
    setValidateError(null);
    if (result?.found) {
      onDeselectIds(result.found);
    }
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const alreadySelected = parsedIds.filter((id) => selected.has(id));

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Instructions */}
      <div
        className="flex items-start gap-2 rounded-md px-3 py-2.5 text-xs"
        style={{
          background: "var(--bg-surface-2)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <ClipboardPaste
          className="mt-0.5 h-3.5 w-3.5 shrink-0"
          aria-hidden="true"
          style={{ color: "var(--fg-muted)" }}
        />
        <p style={{ color: "var(--fg-muted)" }}>
          Paste or type wombat IDs separated by commas, spaces, or new lines
          (e.g. <code className="font-mono">TC-001, TC-002</code>). Press{" "}
          <kbd
            className="rounded px-1 py-0.5 font-mono text-[10px]"
            style={{
              background: "var(--bg-surface-3)",
              border: "1px solid var(--border-default)",
            }}
          >
            Ctrl+Enter
          </kbd>{" "}
          to validate.
        </p>
      </div>

      {/* Textarea */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={textareaId}
          className="text-xs font-medium"
          style={{ color: "var(--fg-muted)" }}
        >
          Wombat IDs
        </label>
        <textarea
          id={textareaId}
          ref={textareaRef}
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            // Reset validation when input changes
            if (status === "done") {
              setStatus("idle");
              setResult(null);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={"TC-001\nTC-002\nTC-003"}
          rows={6}
          disabled={status === "validating"}
          className={cn(
            "w-full resize-none rounded-md border px-3 py-2 font-mono text-sm",
            "placeholder:text-[color:var(--fg-disabled)]",
            "transition-[border-color,box-shadow] duration-150",
            "focus-visible:outline-none focus-visible:border-[color:var(--focus-ring)]",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]/30",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
          style={{
            background: "var(--bg-surface-1)",
            borderColor: "var(--border-default)",
            color: "var(--fg-default)",
          }}
          aria-label="Paste wombat IDs"
          aria-describedby="paste-help"
        />
        <p
          id="paste-help"
          className="text-[11px]"
          style={{ color: "var(--fg-muted)" }}
        >
          {parsedIds.length > 0
            ? `${parsedIds.length} ID${parsedIds.length > 1 ? "s" : ""} detected`
            : "No IDs detected yet"}
          {alreadySelected.length > 0 &&
            ` · ${alreadySelected.length} already selected`}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={!canValidate || status === "validating"}
          onClick={() => void handleValidate()}
          className="gap-1.5"
        >
          {status === "validating" && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          )}
          {status === "validating" ? "Validating..." : "Validate"}
        </Button>

        {(raw.trim() || result) && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            Clear
          </Button>
        )}
      </div>

      {/* Validate error */}
      {validateError && (
        <div
          className="flex items-start gap-2 rounded-md px-3 py-2.5 text-xs"
          role="alert"
          style={{
            background: "var(--feedback-error-bg)",
            border: "1px solid var(--feedback-error-fg)",
          }}
        >
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            aria-hidden="true"
            style={{ color: "var(--feedback-error-fg)" }}
          />
          <p style={{ color: "var(--feedback-error-fg)" }}>{validateError}</p>
        </div>
      )}

      {/* Validation results */}
      {result && status === "done" && (
        <div className="flex flex-col gap-3">
          {result.found.length > 0 && (
            <ValidationGroup
              label={`${result.found.length} valid`}
              ids={result.found}
              variant="success"
            />
          )}
          {result.missing.length > 0 && (
            <ValidationGroup
              label={`${result.missing.length} not found`}
              ids={result.missing}
              variant="error"
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ValidationGroup — chip list for found / missing IDs
// ---------------------------------------------------------------------------

interface ValidationGroupProps {
  label: string;
  ids: string[];
  variant: "success" | "error";
}

function ValidationGroup({ label, ids, variant }: ValidationGroupProps) {
  const isSuccess = variant === "success";
  const Icon = isSuccess ? CheckCircle : XCircle;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Icon
          className="h-3.5 w-3.5 shrink-0"
          aria-hidden="true"
          style={{
            color: isSuccess
              ? "var(--result-pass, #22c55e)"
              : "var(--result-fail, #ef4444)",
          }}
        />
        <span
          className="text-xs font-semibold"
          style={{
            color: isSuccess
              ? "var(--result-pass, #22c55e)"
              : "var(--result-fail, #ef4444)",
          }}
        >
          {label}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <span
            key={id}
            className="rounded px-2 py-0.5 font-mono text-[11px] font-semibold"
            style={{
              background: isSuccess
                ? "color-mix(in srgb, var(--result-pass, #22c55e) 12%, transparent)"
                : "color-mix(in srgb, var(--result-fail, #ef4444) 12%, transparent)",
              color: isSuccess
                ? "var(--result-pass, #22c55e)"
                : "var(--result-fail, #ef4444)",
              border: `1px solid ${isSuccess ? "color-mix(in srgb, var(--result-pass, #22c55e) 30%, transparent)" : "color-mix(in srgb, var(--result-fail, #ef4444) 30%, transparent)"}`,
            }}
          >
            {id}
          </span>
        ))}
      </div>
    </div>
  );
}
