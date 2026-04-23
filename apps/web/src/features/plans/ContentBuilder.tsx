/**
 * ContentBuilder — shared authoring surface for plans and suites (SP3.4 §5.3).
 *
 * Design decisions from frontend-design skill invocations (Tasks 38 + 41):
 * - Two-pane CSS grid: 1.2fr (form) / 1fr (preview) at lg+; single column mobile.
 * - Right pane is `position: sticky; top: 0; height: 100dvh` so it never scrolls
 *   off screen even on long forms. Left pane scrolls independently.
 * - Preview shows a count badge and virtualized case list with source badges +
 *   remove/restore affordances.
 * - kind prop is the single switch; FormPane renders appropriate sub-components.
 * - FormPane assembles: title+desc → FilterBuilder → SuiteRefsPicker (plan) →
 *   ExplicitCasesPicker → MetadataFields. Each section is separated by consistent
 *   spacing and subtle dividers ("coherent document form" — Task 41 skill).
 * - Advanced metadata (assignees, approvals) collapses by default; collapsed
 *   state shows a summary ("2 assignees · 1 approval").
 * - Task 41 complete: FormPane stub replaced with real assembly.
 */

import { useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { useResolveDraft } from "./use-resolve-draft";
import { BuilderPreviewPane } from "./PreviewPane";
import { FilterBuilder } from "./FilterBuilder";
import { SuiteRefsPicker } from "./SuiteRefsPicker";
import { ExplicitCasesPicker } from "./ExplicitCasesPicker";
import { MetadataFields } from "./MetadataFields";
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
// SectionDivider — subtle visual separator between form sections
// ---------------------------------------------------------------------------

function SectionDivider() {
  return (
    <div
      className="h-px w-full"
      aria-hidden="true"
      style={{ background: "var(--border-subtle)" }}
    />
  );
}

// ---------------------------------------------------------------------------
// FormPane — assembled left column (Task 41)
// ---------------------------------------------------------------------------

interface FormPaneProps {
  kind: "plan" | "suite";
  body: ContentBody;
  onChange: (patch: Partial<ContentBody>) => void;
  onExplicitRemove: (wid: string) => void;
  onExplicitRestore: (wid: string) => void;
}

/**
 * FormPane — left column. Assembles:
 *   1. Title + Description (basic information)
 *   2. FilterBuilder (include/exclude)
 *   3. SuiteRefsPicker (plan only)
 *   4. ExplicitCasesPicker (add/remove explicit cases)
 *   5. MetadataFields (kind-switched: plan or suite settings + advanced)
 *
 * Each section is separated by a SectionDivider for the "coherent document
 * form" rhythm (Task 41 frontend-design skill decision).
 */
function FormPane({ kind, body, onChange, onExplicitRemove: _onExplicitRemove, onExplicitRestore: _onExplicitRestore }: FormPaneProps) {
  const planBody = kind === "plan" ? (body as PlanBody) : null;
  const suiteBody = kind === "suite" ? (body as SuiteBody) : null;

  return (
    <div className="flex flex-col gap-6">
      {/* ---------------------------------------------------------------- */}
      {/* 1. Title + Description                                            */}
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
            placeholder={
              kind === "plan"
                ? "e.g. Release 2026.05 — Payments regression"
                : "e.g. Checkout regression"
            }
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
            placeholder={
              kind === "plan"
                ? "Optional. Describe the goal of this plan."
                : "Optional. Describe this suite."
            }
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

      <SectionDivider />

      {/* ---------------------------------------------------------------- */}
      {/* 2. FilterBuilder                                                  */}
      {/* ---------------------------------------------------------------- */}
      <FilterBuilder
        include={{
          tags_any: body.include.tags_any,
          priorities: body.include.priorities,
          components_any: body.include.components_any,
        }}
        exclude={
          planBody
            ? {
                tags_any: planBody.exclude.tags_any,
                priorities: planBody.exclude.priorities,
                components_any: planBody.exclude.components_any,
              }
            : { tags_any: [], priorities: [], components_any: [] }
        }
        onChange={({ include: incPatch, exclude: excPatch }) => {
          if (incPatch) {
            onChange({
              include: { ...body.include, ...incPatch } as FilterBody,
            } as Partial<ContentBody>);
          }
          if (excPatch && planBody) {
            onChange({
              exclude: { ...planBody.exclude, ...excPatch } as FilterBody,
            } as Partial<ContentBody>);
          }
        }}
      />

      {/* ---------------------------------------------------------------- */}
      {/* 3. SuiteRefsPicker — plan only                                    */}
      {/* ---------------------------------------------------------------- */}
      {kind === "plan" && planBody && (
        <>
          <SectionDivider />
          <SuiteRefsPicker
            value={planBody.suite_refs}
            onChange={(suite_refs) =>
              onChange({ suite_refs } as Partial<ContentBody>)
            }
          />
        </>
      )}

      <SectionDivider />

      {/* ---------------------------------------------------------------- */}
      {/* 4. ExplicitCasesPicker                                            */}
      {/* ---------------------------------------------------------------- */}
      <ExplicitCasesPicker
        addIds={
          kind === "plan"
            ? (planBody?.explicit_cases.add ?? [])
            : (suiteBody?.cases ?? [])
        }
        removeIds={
          kind === "plan"
            ? (planBody?.explicit_cases.remove ?? [])
            : []
        }
        onChangeAdd={(ids) => {
          if (kind === "plan") {
            onChange({
              explicit_cases: {
                add: ids,
                remove: planBody?.explicit_cases.remove ?? [],
              },
            } as Partial<ContentBody>);
          } else {
            onChange({ cases: ids } as Partial<ContentBody>);
          }
        }}
        onChangeRemove={(ids) => {
          if (kind === "plan") {
            onChange({
              explicit_cases: {
                add: planBody?.explicit_cases.add ?? [],
                remove: ids,
              },
            } as Partial<ContentBody>);
          }
          // suites don't have a separate remove list
        }}
      />

      <SectionDivider />

      {/* ---------------------------------------------------------------- */}
      {/* 5. MetadataFields                                                 */}
      {/* ---------------------------------------------------------------- */}
      <MetadataFields
        kind={kind}
        planMeta={
          planBody
            ? {
                environments: planBody.environments,
                release: planBody.release,
                assignees: planBody.assignees,
                approvals: planBody.approvals,
              }
            : undefined
        }
        suiteMeta={
          suiteBody
            ? {
                parent_wombat_id: suiteBody.parent_wombat_id,
                owner: suiteBody.owner,
                tags: suiteBody.tags,
              }
            : undefined
        }
        onChangePlan={(patch) => onChange(patch as Partial<ContentBody>)}
        onChangeSuite={(patch) => onChange(patch as Partial<ContentBody>)}
      />

      {/* Spacer so the last section doesn't butt up against the footer */}
      <div className="h-2" aria-hidden="true" />
    </div>
  );
}

// keep the prop types used by the inner FormPane visible for the
// onExplicitRemove / onExplicitRestore wiring that ContentBuilder still owns
void ((_: FormPaneProps) => {}); // type-use sentinel — prevents TS unused-type warning

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
