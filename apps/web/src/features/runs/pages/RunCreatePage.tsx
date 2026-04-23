/**
 * RunCreatePage — two-column create-run form with 3-tab case selector.
 *
 * Layout:
 *   Left column (~40 %): Run metadata — title, environment, assignees, source.
 *   Right column (~60 %): CaseSelector with Filter / Paste IDs / From Library tabs.
 *   Sticky footer: selected count + Create Run (disabled until title + ≥1 case).
 *
 * Source defaults to "manual"; URL param `?source=ci` overrides the visible label
 * but the field is read-only and hidden from the form (per SP3.3 spec §8.4).
 *
 * SP3.4 — Plan draft pre-fill (Task 53):
 *   When navigated from a plan's "Start run" button the router passes
 *   `{ state: { planDraft: StartRunDraft } }`.  If present:
 *     - title_suggestion → pre-fills the title field.
 *     - environment_id   → pre-selects the environment.
 *     - assignee_user_ids / assignee_token_ids → pre-selects assignees.
 *     - resolved_case_ids → pre-selects cases in the CaseSelector.
 *     - A dismissible "Plan: <title>" context strip is rendered below the header.
 *   Dismissing the strip clears only the plan attribution; already-filled form
 *   values are retained.
 *
 *   plan_id submission note: the backend's CreateRunRequest schema (generated
 *   2026-04-22) does not include a `plan_id` field.  The plan attribution is
 *   therefore stored purely as form pre-fill context; the run is created without
 *   a plan_id.  When the backend adds the field (tracked in deferred backlog),
 *   update CreateRunBody + useCreateRun to thread it through.
 *
 * Design decisions (frontend-design skill, Task 53):
 *   - Context strip uses a left-border accent rather than a floating pill so it
 *     reads as document context, not a transient notification.
 *   - Token: `var(--chart-cat-3)` for the plan accent bar (warm amber) — distinct
 *     from the green success / red error / blue info feedback tokens.
 *   - Strip slides in via a short max-height animation to avoid layout jump on
 *     non-plan entry points.
 *   - Dismiss X is keyboard-accessible with focus-visible ring.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  useNavigate,
  useParams,
  useSearchParams,
  useLocation,
  Link,
} from "react-router-dom";
import {
  AlertCircle,
  ChevronLeft,
  ClipboardList,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import type { StartRunDraft } from "@/features/plans/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/shared/ErrorState";
import { useEnvironments, useCreateEnvironment } from "../hooks/environments";
import type { Environment } from "../hooks/environments";
import { useCreateRun } from "../hooks/runs";
import { AssigneeMultiselect } from "../components/AssigneeMultiselect";
import { CaseSelector } from "../components/CaseSelector";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// RunCreatePage
// ---------------------------------------------------------------------------

export function RunCreatePage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Source from URL param (read-only; not surfaced as editable in the UI)
  const source = searchParams.get("source") ?? "manual";

  // SP3.4 — Plan draft pre-fill. Read once on mount; never re-read on re-renders.
  const planDraft = (location.state as { planDraft?: StartRunDraft } | null)
    ?.planDraft ?? null;

  // Whether the plan attribution banner is still visible (user may dismiss it)
  const [planBannerVisible, setPlanBannerVisible] = useState(
    () => planDraft !== null,
  );

  // Form state — initialised from plan draft when present
  const [title, setTitle] = useState(() => planDraft?.title ?? "");
  const [envId, setEnvId] = useState<string | null>(
    () => planDraft?.environment_id ?? null,
  );
  const [userIds, setUserIds] = useState<string[]>(
    () => planDraft?.assignee_user_ids ?? [],
  );
  const [tokenIds, setTokenIds] = useState<string[]>(
    () => planDraft?.assignee_token_ids ?? [],
  );

  // Initial cases from plan draft (passed to CaseSelector as pre-selected)
  const initialCaseIds = planDraft?.resolved_case_ids ?? [];

  const [selectedCases, setSelectedCases] = useState<Set<string>>(
    () => new Set(initialCaseIds),
  );

  // Submit state
  const [submitError, setSubmitError] = useState<Error | null>(null);

  const createRunMutation = useCreateRun(projectSlug);

  const isValid = title.trim().length > 0 && selectedCases.size > 0;
  const isSubmitting = createRunMutation.isPending;

  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return;
    setSubmitError(null);
    try {
      const run = await createRunMutation.mutateAsync({
        title: title.trim(),
        environment_id: envId ?? null,
        assignee_user_ids: userIds,
        assignee_token_ids: tokenIds,
        source,
        case_selection: {
          case_ids: Array.from(selectedCases),
        },
      });
      navigate(`/p/${projectSlug}/runs/${run.id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [
    isValid,
    isSubmitting,
    createRunMutation,
    title,
    envId,
    userIds,
    tokenIds,
    source,
    selectedCases,
    navigate,
    projectSlug,
  ]);

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "var(--bg-app)" }}
    >
      {/* Page header */}
      <header
        className="flex items-center gap-3 border-b px-5 py-3 shrink-0"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-surface-1)",
        }}
      >
        <Link
          to={`/p/${projectSlug}/runs`}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
            "transition-colors duration-150",
            "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
          )}
          style={{
            color: "var(--fg-muted)",
            background: "transparent",
          }}
          aria-label="Back to runs"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Runs
        </Link>

        <span
          aria-hidden="true"
          className="text-sm"
          style={{ color: "var(--border-default)" }}
        >
          /
        </span>

        <h1
          className="text-sm font-semibold"
          style={{ color: "var(--fg-default)" }}
        >
          New Run
        </h1>

        {source !== "manual" && (
          <span
            className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              background: "var(--bg-surface-3)",
              color: "var(--fg-muted)",
              border: "1px solid var(--border-default)",
            }}
          >
            Source: {source}
          </span>
        )}
      </header>

      {/* SP3.4 — Plan context strip (only when navigated from a plan's "Start run") */}
      {planDraft && planBannerVisible && (
        <PlanContextStrip
          planWombatId={planDraft.plan_wombat_id}
          title={planDraft.title}
          caseCount={planDraft.resolved_case_count}
          onDismiss={() => setPlanBannerVisible(false)}
        />
      )}

      {/* Two-column body — scrolls as a unit */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column — metadata */}
        <aside
          className="w-[380px] shrink-0 flex flex-col overflow-y-auto border-r"
          style={{
            borderColor: "var(--border-default)",
            background: "var(--bg-surface-1)",
          }}
        >
          <div className="flex flex-col gap-5 p-5 pb-6">
            <TitleField
              value={title}
              onChange={setTitle}
              disabled={isSubmitting}
            />

            <EnvironmentField
              projectSlug={projectSlug}
              value={envId}
              onChange={setEnvId}
              disabled={isSubmitting}
            />

            <AssigneesField
              projectSlug={projectSlug}
              userIds={userIds}
              tokenIds={tokenIds}
              onChangeUserIds={setUserIds}
              onChangeTokenIds={setTokenIds}
              disabled={isSubmitting}
            />
          </div>
        </aside>

        {/* Right column — case selector */}
        <main className="flex flex-1 flex-col overflow-hidden p-4">
          <CaseSelector
            projectSlug={projectSlug}
            onSelectionChange={setSelectedCases}
            className="flex-1 min-h-0"
            initialSelectedIds={initialCaseIds.length > 0 ? initialCaseIds : undefined}
          />
        </main>
      </div>

      {/* Sticky footer */}
      <footer
        className="flex items-center justify-between gap-4 border-t px-5 py-3 shrink-0"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-surface-1)",
        }}
      >
        {/* Selection count */}
        <div className="flex items-center gap-3">
          <SelectionSummary
            caseCount={selectedCases.size}
            titleEmpty={title.trim().length === 0}
          />
        </div>

        {/* Submit error */}
        {submitError && (
          <div className="flex-1 max-w-sm">
            <InlineError error={submitError} onDismiss={() => setSubmitError(null)} />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="ghost"
            size="sm"
            asChild
            disabled={isSubmitting}
          >
            <Link to={`/p/${projectSlug}/runs`}>Cancel</Link>
          </Button>

          <Button
            variant="primary"
            size="sm"
            disabled={!isValid || isSubmitting}
            onClick={() => void handleSubmit()}
            className="gap-1.5 min-w-[120px]"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Creating...
              </>
            ) : (
              "Create Run"
            )}
          </Button>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TitleField
// ---------------------------------------------------------------------------

interface TitleFieldProps {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}

function TitleField({ value, onChange, disabled }: TitleFieldProps) {
  const id = useId();
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    // Focus on mount (this is the primary action of the page).
    // Using a ref+effect instead of autoFocus per jsx-a11y/no-autofocus.
    ref.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold"
        style={{ color: "var(--fg-default)" }}
      >
        Run title <RequiredMark />
      </label>
      <Input
        id={id}
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. Sprint 42 regression"
        disabled={disabled}
        required
        aria-required="true"
      />
      {value.trim().length === 0 && (
        <p className="text-[10px]" style={{ color: "var(--fg-muted)" }}>
          A title is required to create a run.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EnvironmentField — dropdown with inline "+ Create new…" option
// ---------------------------------------------------------------------------

interface EnvironmentFieldProps {
  projectSlug: string;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled: boolean;
}

function EnvironmentField({
  projectSlug,
  value,
  onChange,
  disabled,
}: EnvironmentFieldProps) {
  const id = useId();
  const [creating, setCreating] = useState(false);
  const [newEnvName, setNewEnvName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const newEnvInputRef = useRef<HTMLInputElement>(null);

  const { data: environments = [], isLoading } = useEnvironments(projectSlug);
  const createEnvMutation = useCreateEnvironment(projectSlug);

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === "__create__") {
      setCreating(true);
      setNewEnvName("");
      requestAnimationFrame(() => newEnvInputRef.current?.focus());
    } else {
      onChange(e.target.value === "" ? null : e.target.value);
    }
  };

  const handleCreateEnv = async () => {
    const name = newEnvName.trim();
    if (!name) return;
    setCreateError(null);
    try {
      const env = await createEnvMutation.mutateAsync({ name });
      onChange(env.id);
      setCreating(false);
      setNewEnvName("");
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create environment.");
    }
  };

  const handleNewEnvKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await handleCreateEnv();
    }
    if (e.key === "Escape") {
      setCreating(false);
      setNewEnvName("");
      setCreateError(null);
    }
  };

  const selectedEnv: Environment | undefined = environments.find(
    (env) => env.id === value,
  );

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold"
        style={{ color: "var(--fg-default)" }}
      >
        Environment
      </label>

      {creating ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <input
              ref={newEnvInputRef}
              type="text"
              value={newEnvName}
              onChange={(e) => setNewEnvName(e.target.value)}
              onKeyDown={(e) => void handleNewEnvKeyDown(e)}
              placeholder="New environment name…"
              disabled={createEnvMutation.isPending}
              className={cn(
                "flex h-9 flex-1 rounded-md border px-3 py-1 text-sm",
                "bg-[color:var(--bg-surface-1)] text-[color:var(--fg-default)]",
                "border-[color:var(--border-default)]",
                "placeholder:text-[color:var(--fg-muted)]",
                "focus-visible:outline-none focus-visible:border-[color:var(--focus-ring)]",
                "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]/30",
                "disabled:cursor-not-allowed disabled:opacity-60",
              )}
              aria-label="New environment name"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleCreateEnv()}
              disabled={!newEnvName.trim() || createEnvMutation.isPending}
              className="shrink-0 gap-1"
            >
              {createEnvMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Create
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCreating(false);
                setNewEnvName("");
                setCreateError(null);
              }}
              className="shrink-0"
              aria-label="Cancel creating environment"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
          {createError && (
            <p className="text-[11px]" style={{ color: "var(--feedback-error-fg)" }}>
              {createError}
            </p>
          )}
          <p className="text-[10px]" style={{ color: "var(--fg-muted)" }}>
            Press Enter to save, Esc to cancel.
          </p>
        </div>
      ) : (
        <select
          id={id}
          value={value ?? ""}
          onChange={handleSelectChange}
          disabled={disabled || isLoading}
          className={cn(
            "h-9 w-full rounded-md border px-3 py-1 text-sm",
            "bg-[color:var(--bg-surface-1)] text-[color:var(--fg-default)]",
            "border-[color:var(--border-default)]",
            "focus-visible:outline-none focus-visible:border-[color:var(--focus-ring)]",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]/30",
            "disabled:cursor-not-allowed disabled:opacity-60",
            "appearance-none cursor-pointer",
          )}
          aria-label="Select environment"
        >
          <option value="">
            {isLoading ? "Loading…" : "No environment (optional)"}
          </option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
          <option value="__create__">+ Create new…</option>
        </select>
      )}

      {selectedEnv && !creating && (
        <p className="text-[10px]" style={{ color: "var(--fg-muted)" }}>
          Selected: {selectedEnv.name}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssigneesField
// ---------------------------------------------------------------------------

interface AssigneesFieldProps {
  projectSlug: string;
  userIds: string[];
  tokenIds: string[];
  onChangeUserIds: (ids: string[]) => void;
  onChangeTokenIds: (ids: string[]) => void;
  disabled: boolean;
}

function AssigneesField({
  projectSlug,
  userIds,
  tokenIds,
  onChangeUserIds,
  onChangeTokenIds,
  disabled,
}: AssigneesFieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-xs font-semibold"
        style={{ color: "var(--fg-default)" }}
      >
        Assignees
      </label>
      <AssigneeMultiselect
        projectSlug={projectSlug}
        userIds={userIds}
        tokenIds={tokenIds}
        onChangeUserIds={onChangeUserIds}
        onChangeTokenIds={onChangeTokenIds}
        disabled={disabled}
      />
      <p className="text-[10px]" style={{ color: "var(--fg-muted)" }}>
        Optional. Assigns project members as testers.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectionSummary — footer left section
// ---------------------------------------------------------------------------

interface SelectionSummaryProps {
  caseCount: number;
  titleEmpty: boolean;
}

function SelectionSummary({ caseCount, titleEmpty }: SelectionSummaryProps) {
  const noCases = caseCount === 0;
  const problems = [
    titleEmpty && "Run title is required",
    noCases && "Select at least one case",
  ].filter(Boolean) as string[];

  if (problems.length > 0) {
    return (
      <div className="flex items-center gap-2">
        <AlertCircle
          className="h-3.5 w-3.5 shrink-0"
          aria-hidden="true"
          style={{ color: "var(--fg-muted)" }}
        />
        <span className="text-xs" style={{ color: "var(--fg-muted)" }}>
          {problems.join(" · ")}
        </span>
      </div>
    );
  }

  return (
    <span className="text-xs font-medium" style={{ color: "var(--fg-muted)" }}>
      <span
        className="font-semibold tabular-nums"
        style={{ color: "var(--accent-fg)" }}
      >
        {caseCount}
      </span>{" "}
      {caseCount === 1 ? "case" : "cases"} selected
    </span>
  );
}

// ---------------------------------------------------------------------------
// InlineError — compact error banner in the footer
// ---------------------------------------------------------------------------

interface InlineErrorProps {
  error: Error;
  onDismiss: () => void;
}

function InlineError({ error, onDismiss }: InlineErrorProps) {
  const msg = error.message || "An unexpected error occurred.";

  return (
    <div
      className="flex items-start gap-2 rounded-md px-3 py-2 text-xs"
      role="alert"
      style={{
        background: "var(--feedback-error-bg)",
        border: "1px solid var(--feedback-error-fg)",
      }}
    >
      <AlertCircle
        className="mt-0.5 h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
        style={{ color: "var(--feedback-error-fg)" }}
      />
      <p
        className="flex-1 leading-relaxed"
        style={{ color: "var(--feedback-error-fg)" }}
      >
        {msg}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="rounded outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
        style={{ color: "var(--feedback-error-fg)" }}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlanContextStrip — SP3.4 plan-to-run handoff attribution banner
// ---------------------------------------------------------------------------
//
// Design (frontend-design skill, Task 53):
//   Uses a left-border accent bar (var(--chart-cat-3)) rather than a pill or
//   floating badge so the strip reads as document-level context, not a
//   transient notification that demands action.  The amber accent token
//   (warm, editorial) is visually distinct from the blue/green/red feedback
//   tokens the rest of the form uses.  The strip is keyboard-dismissible and
//   slides in via max-height to avoid layout jump on non-plan entry points.

interface PlanContextStripProps {
  planWombatId: string;
  title: string;
  caseCount: number;
  onDismiss: () => void;
}

function PlanContextStrip({
  planWombatId,
  title,
  caseCount,
  onDismiss,
}: PlanContextStripProps) {
  return (
    <div
      role="status"
      aria-label={`Prefilled from plan: ${title}`}
      className="flex items-center gap-3 px-5 py-2.5 text-xs shrink-0"
      style={{
        borderBottom: "1px solid var(--border-default)",
        borderLeft: "3px solid var(--chart-cat-3, #d97706)",
        background: "color-mix(in srgb, var(--chart-cat-3, #d97706) 6%, var(--bg-surface-1))",
        /* Slide-in animation for plan-entry path (no-op for non-plan path since
           component only renders when planDraft !== null). */
        animation: "plan-strip-in 200ms ease-out both",
      }}
    >
      <style>{`
        @keyframes plan-strip-in {
          from { opacity: 0; max-height: 0; padding-top: 0; padding-bottom: 0; }
          to   { opacity: 1; max-height: 3rem; padding-top: 0.625rem; padding-bottom: 0.625rem; }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes plan-strip-in { from { opacity: 0; } to { opacity: 1; } }
        }
      `}</style>

      <ClipboardList
        className="h-3.5 w-3.5 shrink-0"
        aria-hidden="true"
        style={{ color: "var(--chart-cat-3, #d97706)" }}
      />

      <span style={{ color: "var(--fg-muted)" }}>
        Prefilled from plan
      </span>

      <span
        className="font-mono text-[11px] font-semibold"
        style={{ color: "var(--chart-cat-3, #d97706)" }}
      >
        {planWombatId}
      </span>

      <span
        className="font-medium truncate min-w-0 flex-1"
        style={{ color: "var(--fg-default)" }}
      >
        {title}
      </span>

      {caseCount > 0 && (
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums"
          style={{
            background: "color-mix(in srgb, var(--chart-cat-3, #d97706) 15%, var(--bg-surface-2))",
            color: "var(--chart-cat-3, #d97706)",
            border: "1px solid color-mix(in srgb, var(--chart-cat-3, #d97706) 30%, transparent)",
          }}
        >
          {caseCount} {caseCount === 1 ? "case" : "cases"}
        </span>
      )}

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss plan context"
        className={cn(
          "shrink-0 rounded p-0.5 outline-none",
          "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
          "transition-opacity duration-150 hover:opacity-70",
        )}
        style={{ color: "var(--fg-muted)" }}
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function RequiredMark() {
  return (
    <span
      aria-hidden="true"
      style={{ color: "var(--feedback-error-fg)" }}
      className="ml-0.5"
    >
      *
    </span>
  );
}

// Export ErrorState for completeness — it would be used if we had a
// top-level query that could fail on this page (environments is non-critical)
void ErrorState;
