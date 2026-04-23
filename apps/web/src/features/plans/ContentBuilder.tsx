/**
 * ContentBuilder — shared authoring surface for plans and suites (SP3.4 §5.3).
 *
 * Design decisions from frontend-design skill invocation (Task 38):
 * - Two-pane CSS grid: 1.2fr (form) / 1fr (preview) at lg+; single column mobile.
 * - Right pane is `position: sticky; top: 0; height: 100dvh` so it never scrolls
 *   off screen even on long forms. Left pane scrolls independently.
 * - Preview shows a count badge ("142 matching cases") and a virtualized list of
 *   resolved cases, each row carrying source badges + remove/restore affordances.
 * - Loading state = spinner overlay on the right pane; left pane still interactive.
 * - Empty plan body = right pane shows a prompt to add filters or cases.
 * - kind prop is the single switch: plan shows suite_refs/environments/assignees/
 *   approvals; suite shows parent/owner/tags. Same component, no twin.
 * - FormPane is assembled in Task 41 — stubbed here.
 */

import { useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { useResolveDraft } from "./use-resolve-draft";
import { BuilderPreviewPane } from "./PreviewPane";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Body shapes
// ---------------------------------------------------------------------------

export interface ExplicitCases {
  add: string[];
  remove: string[];
}

export interface FilterBody {
  tags_any: string[];
  tags_all: string[];
  priorities: string[];
  components_any: string[];
}

export interface PlanBody {
  title: string;
  description: string;
  include: FilterBody;
  exclude: FilterBody;
  suite_refs: string[];
  explicit_cases: ExplicitCases;
  environments: string[];
  assignees: string[];
  approvals: string[];
  release: string;
}

export interface SuiteBody {
  title: string;
  description: string;
  parent_wombat_id: string | null;
  cases: string[];
  include: FilterBody;
  owner: string;
  tags: string[];
}

export type ContentBody = PlanBody | SuiteBody;

function emptyFilter(): FilterBody {
  return { tags_any: [], tags_all: [], priorities: [], components_any: [] };
}

function defaultBody(kind: "plan" | "suite"): ContentBody {
  if (kind === "plan") {
    return {
      title: "",
      description: "",
      include: emptyFilter(),
      exclude: emptyFilter(),
      suite_refs: [],
      explicit_cases: { add: [], remove: [] },
      environments: [],
      assignees: [],
      approvals: [],
      release: "",
    } satisfies PlanBody;
  }
  return {
    title: "",
    description: "",
    parent_wombat_id: null,
    cases: [],
    include: emptyFilter(),
    owner: "",
    tags: [],
  } satisfies SuiteBody;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ContentBuilderProps {
  kind: "plan" | "suite";
  mode: "create" | "edit";
  /** Pre-populated values for edit mode. */
  initial?: Partial<ContentBody>;
  /**
   * Called when the user submits the form. Receives the current body.
   * The caller is responsible for posting to the proposals endpoint.
   */
  onSave: (body: ContentBody) => void | Promise<void>;
  /** Called when the user clicks Cancel. */
  onCancel?: () => void;
  /** If true, a "Publish directly" button is shown alongside "Propose change". */
  canPublishDirect?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// FormPane stub — filled in by Task 41
// ---------------------------------------------------------------------------

interface FormPaneProps {
  kind: "plan" | "suite";
  body: ContentBody;
  onChange: (patch: Partial<ContentBody>) => void;
  onExplicitRemove: (wid: string) => void;
  onExplicitRestore: (wid: string) => void;
}

/**
 * FormPane — left column. Stubbed here; Task 41 imports and assembles
 * FilterBuilder + ExplicitCasesPicker + SuiteRefsPicker + MetadataFields.
 */
function FormPane({ kind, body, onChange, onExplicitRemove, onExplicitRestore }: FormPaneProps) {
  // Task 41 replaces this stub with the assembled form.
  // The props are final so the sub-components can be wired without touching
  // ContentBuilder itself.
  void onExplicitRemove;
  void onExplicitRestore;

  return (
    <div className="flex flex-col gap-6">
      {/* ---------------------------------------------------------------- */}
      {/* Title + Description                                               */}
      {/* ---------------------------------------------------------------- */}
      <section aria-label="Basic information" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label
            htmlFor="cb-title"
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--fg-muted)" }}
          >
            Title
            <span aria-hidden="true" style={{ color: "var(--feedback-error-fg)" }}> *</span>
          </label>
          <input
            id="cb-title"
            type="text"
            value={body.title}
            onChange={(e) => onChange({ title: e.target.value } as Partial<ContentBody>)}
            placeholder={kind === "plan" ? "e.g. Release 2026.05 — Payments regression" : "e.g. Checkout regression"}
            required
            className={cn(
              "w-full rounded-md px-3 py-2 text-sm",
              "border outline-none transition-all",
              "focus:ring-2 focus:ring-[color:var(--focus-ring)] focus:ring-offset-1",
            )}
            style={{
              background: "var(--bg-surface-1)",
              border: "1px solid var(--border-default)",
              color: "var(--fg-default)",
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="cb-description"
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "var(--fg-muted)" }}
          >
            Description
          </label>
          <textarea
            id="cb-description"
            value={body.description}
            onChange={(e) => onChange({ description: e.target.value } as Partial<ContentBody>)}
            placeholder="Optional. Describe the purpose of this plan."
            rows={3}
            className={cn(
              "w-full rounded-md px-3 py-2 text-sm resize-none",
              "border outline-none transition-all",
              "focus:ring-2 focus:ring-[color:var(--focus-ring)] focus:ring-offset-1",
            )}
            style={{
              background: "var(--bg-surface-1)",
              border: "1px solid var(--border-default)",
              color: "var(--fg-default)",
            }}
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Placeholder area — Task 41 inserts sub-components here           */}
      {/* ---------------------------------------------------------------- */}
      <div
        className="rounded-md border-2 border-dashed px-4 py-6 text-center text-xs"
        style={{
          borderColor: "var(--border-subtle)",
          color: "var(--fg-disabled)",
        }}
        aria-label="Form sub-components placeholder"
      >
        FilterBuilder · {kind === "plan" ? "SuiteRefsPicker · " : ""}ExplicitCasesPicker · MetadataFields
        <br />
        <span style={{ color: "var(--fg-disabled)" }}>(assembled in Task 41)</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContentBuilder
// ---------------------------------------------------------------------------

/**
 * ContentBuilder — single shared authoring surface for plan and suite content.
 *
 * Never duplicated. kind prop discriminates which fields are visible.
 * mode="create" | "edit" only affects the page title and save button label.
 *
 * Live preview: useResolveDraft fires a debounced POST to /content/resolve
 * (250ms) and renders the resolved case list in the right pane.
 */
export function ContentBuilder({
  kind,
  mode,
  initial,
  onSave,
  onCancel,
  canPublishDirect = false,
  className,
}: ContentBuilderProps) {
  const { slug = "" } = useParams<{ slug: string }>();

  // Local draft body — initialized from `initial` or an empty default.
  const [body, setBody] = useState<ContentBody>(() => {
    if (initial) {
      const base = defaultBody(kind);
      return { ...base, ...initial } as ContentBody;
    }
    return defaultBody(kind);
  });

  // Track explicit-removes made via the preview pane remove buttons.
  // These sync with ExplicitCasesPicker in Task 40.
  const handleExplicitRemove = useCallback((wid: string) => {
    setBody((prev) => {
      if (kind === "plan") {
        const plan = prev as PlanBody;
        const currentRemove = plan.explicit_cases.remove;
        if (currentRemove.includes(wid)) return prev;
        return {
          ...plan,
          explicit_cases: {
            ...plan.explicit_cases,
            remove: [...currentRemove, wid],
          },
        };
      }
      return prev; // suites handle via their own explicit cases list
    });
  }, [kind]);

  const handleExplicitRestore = useCallback((wid: string) => {
    setBody((prev) => {
      if (kind === "plan") {
        const plan = prev as PlanBody;
        return {
          ...plan,
          explicit_cases: {
            ...plan.explicit_cases,
            remove: plan.explicit_cases.remove.filter((id) => id !== wid),
          },
        };
      }
      return prev;
    });
  }, [kind]);

  const handleChange = useCallback((patch: Partial<ContentBody>) => {
    setBody((prev) => ({ ...prev, ...patch }));
  }, []);

  // Live preview hook — debounced 250ms, AbortController on key change.
  const resolveQuery = useResolveDraft(slug, kind, body);

  // Saving state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current?.checkValidity()) {
      formRef.current?.reportValidity();
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(body);
    } catch (err) {
      setSaveError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsSaving(false);
    }
  }

  const pageTitle = mode === "create"
    ? kind === "plan" ? "New plan" : "New suite"
    : kind === "plan" ? "Edit plan" : "Edit suite";

  return (
    <div
      className={cn("flex flex-col gap-0", className)}
      style={{ minHeight: "100%" }}
    >
      {/* ---------------------------------------------------------------- */}
      {/* Header bar                                                        */}
      {/* ---------------------------------------------------------------- */}
      <div
        className="shrink-0 flex items-center justify-between px-6 py-4 border-b"
        style={{
          background: "var(--bg-surface-1)",
          borderColor: "var(--border-default)",
        }}
      >
        <h1
          className="text-base font-semibold"
          style={{ color: "var(--fg-default)" }}
        >
          {pageTitle}
        </h1>
        <div
          className="text-xs font-medium px-2 py-0.5 rounded"
          style={{
            background: kind === "plan" ? "var(--accent-soft)" : "var(--feedback-warn-bg)",
            color: kind === "plan" ? "var(--accent-fg)" : "var(--feedback-warn-fg)",
          }}
        >
          {kind}
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Two-pane layout                                                   */}
      {/* ---------------------------------------------------------------- */}
      <div
        className={cn(
          "flex-1 grid grid-cols-1",
          "lg:grid-cols-[1.2fr_1fr]",
        )}
        style={{ minHeight: 0 }}
      >
        {/* Left pane: scrolling form */}
        <div
          className="overflow-y-auto"
          style={{ background: "var(--bg-app)" }}
        >
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col h-full"
          >
            {/* Scrollable form content */}
            <div className="flex-1 px-6 py-6">
              <FormPane
                kind={kind}
                body={body}
                onChange={handleChange}
                onExplicitRemove={handleExplicitRemove}
                onExplicitRestore={handleExplicitRestore}
              />
            </div>

            {/* -------------------------------------------------------- */}
            {/* Footer action bar — sticky at bottom of left pane         */}
            {/* -------------------------------------------------------- */}
            <div
              className="shrink-0 flex items-center gap-3 px-6 py-4 border-t"
              style={{
                background: "var(--bg-surface-1)",
                borderColor: "var(--border-default)",
              }}
            >
              {saveError && (
                <p
                  className="text-xs mr-auto"
                  style={{ color: "var(--feedback-error-fg)" }}
                  role="alert"
                >
                  {saveError.message}
                </p>
              )}

              {onCancel && !saveError && (
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={isSaving}
                  className={cn(
                    "mr-auto text-sm px-4 py-1.5 rounded-md border",
                    "transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
                    "disabled:opacity-50 disabled:pointer-events-none",
                  )}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--border-default)",
                    color: "var(--fg-muted)",
                  }}
                >
                  Cancel
                </button>
              )}

              {canPublishDirect && (
                <button
                  type="submit"
                  name="action"
                  value="publish"
                  disabled={isSaving}
                  className={cn(
                    "text-sm px-4 py-1.5 rounded-md border",
                    "transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
                    "disabled:opacity-50 disabled:pointer-events-none",
                  )}
                  style={{
                    background: "var(--bg-surface-2)",
                    border: "1px solid var(--border-default)",
                    color: "var(--fg-default)",
                  }}
                >
                  Publish directly
                </button>
              )}

              <button
                type="submit"
                disabled={isSaving}
                className={cn(
                  "text-sm px-4 py-1.5 rounded-md",
                  "transition-colors outline-none",
                  "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-offset-1",
                  "disabled:opacity-50 disabled:pointer-events-none",
                )}
                style={{
                  background: isSaving ? "var(--accent-primary-hover)" : "var(--accent-primary)",
                  color: "var(--fg-inverse)",
                }}
              >
                {isSaving
                  ? "Saving…"
                  : mode === "create" ? "Propose" : "Propose change"}
              </button>
            </div>
          </form>
        </div>

        {/* Right pane: sticky preview */}
        <BuilderPreviewPane
          resolveQuery={resolveQuery}
          kind={kind}
          onRemove={handleExplicitRemove}
          onRestore={handleExplicitRestore}
          removedIds={
            kind === "plan"
              ? (body as PlanBody).explicit_cases.remove
              : []
          }
        />
      </div>
    </div>
  );
}
