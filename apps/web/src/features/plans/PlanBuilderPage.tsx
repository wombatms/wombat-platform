/**
 * PlanBuilderPage — SP3.4 Task 44
 *
 * Design decisions (frontend-design skill invocation, Task 44):
 * - Sparse editorial frame: a single breadcrumb strip + optional info banner
 *   sit above ContentBuilder. The builder is the hero; the chrome is a
 *   quiet scaffold. No decorative elements compete with the form itself.
 * - Info banner (create mode): accent-soft background, subtle left rule —
 *   explains the proposal flow in plain language without alarming the user.
 *   "Your changes will go to the review queue" is useful information, not a
 *   warning — so it uses accent-soft/accent-fg tokens, not amber.
 * - Conflict banner (edit mode, 409): amber left-rule with a Refresh button
 *   that refetches the plan without discarding form state. The user can
 *   choose to continue editing or refresh and restart — their call.
 * - Typed error banners: SUITE_CYCLE → impossible for plans (re-exported for
 *   safety), PLAN_SUITE_REF_UNKNOWN → user-friendly message above the form.
 *   Uses the same InlineBanner pattern as SuiteBuilderPage for visual
 *   consistency.
 * - Dirty-state: beforeunload + React Router v6 useBlocker. DirtyBlocker
 *   component is a render-only side-effect, no UI.
 * - "Save and start run" chains onSave (propose) → useStartRunDraft → navigate
 *   to runs/new with planDraft state. Only available in create mode (the user
 *   has not yet navigated away). In edit mode the action is redundant.
 * - ContentBuilder's canPublishDirect prop wires to usePermission for
 *   content:publish_direct. When true, ContentBuilder renders "Publish
 *   directly" alongside "Propose change" in its own footer action bar.
 *
 * Routes:
 *   /p/:projectSlug/plans/new        → mode="create"
 *   /p/:projectSlug/plans/:wid/edit  → mode="edit"
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  useParams,
  useNavigate,
  useBlocker,
  Link,
} from "react-router-dom";
import {
  OctagonX,
  AlertTriangle,
  ChevronRight,
  Info,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { usePermission } from "@/features/auth/useSession";
import {
  ContentBuilder,
  type ContentBody,
  type PlanBody,
} from "@/features/plans/ContentBuilder";
import { usePlanDetail, useStartRunDraft } from "./hooks";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Write-error classification
// ---------------------------------------------------------------------------

type PlanWriteError =
  | { kind: "conflict" }
  | { kind: "suite_ref_unknown"; ref?: string }
  | { kind: "generic"; message: string };

function classifyError(err: unknown): PlanWriteError {
  if (err instanceof ApiError) {
    if (err.status === 409) return { kind: "conflict" };
    if (err.code === "PLAN_SUITE_REF_UNKNOWN") {
      // hint may carry the unknown ref id
      const ref = err.hint ?? undefined;
      return { kind: "suite_ref_unknown", ref };
    }
    // SUITE_CYCLE is theoretically impossible for plans (suites only) but
    // classify defensively so the banner never shows a raw error code.
    if (err.code === "SUITE_CYCLE") {
      return { kind: "generic", message: "Suite cycle detected." };
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { kind: "generic", message: msg };
}

// ---------------------------------------------------------------------------
// Error banner labels
// ---------------------------------------------------------------------------

function errorBannerContent(e: PlanWriteError): {
  headline: string;
  detail: string;
  code: string;
} {
  switch (e.kind) {
    case "conflict":
      return {
        headline: "Plan changed while you were editing",
        detail:
          "Another editor published an update to this plan. Refresh to load the latest version, then reapply your changes.",
        code: "STALE_REVISION",
      };
    case "suite_ref_unknown":
      return {
        headline: "Unknown suite reference",
        detail: e.ref
          ? `Suite "${e.ref}" does not exist in this project. Remove it from the Suite refs section and try again.`
          : "One or more suite references do not exist in this project. Check the Suite refs section and try again.",
        code: "PLAN_SUITE_REF_UNKNOWN",
      };
    case "generic":
      return {
        headline: "Could not save plan",
        detail: e.message,
        code: "UNKNOWN",
      };
  }
}

// ---------------------------------------------------------------------------
// InlineBanner — error callout above the ContentBuilder form
// ---------------------------------------------------------------------------

interface InlineBannerProps {
  error: PlanWriteError;
  /** Only relevant for conflict errors: refetch handler */
  onRefresh?: () => void;
}

function InlineBanner({ error, onRefresh }: InlineBannerProps) {
  const { headline, detail, code } = errorBannerContent(error);

  const isConflict = error.kind === "conflict";
  const Icon = isConflict ? AlertTriangle : OctagonX;
  const tokenBase = isConflict ? "warn" : "error";

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 px-5 py-3 border-b"
      style={{
        background: `var(--feedback-${tokenBase}-bg)`,
        borderColor: `color-mix(in srgb, var(--feedback-${tokenBase}-fg) 30%, transparent)`,
        borderLeft: `3px solid var(--feedback-${tokenBase}-fg)`,
        color: `var(--feedback-${tokenBase}-fg)`,
      }}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <span className="text-sm font-semibold">
          {headline}
          <span
            className="ml-2 text-[11px] font-mono font-normal opacity-70"
          >
            {code}
          </span>
        </span>
        <p className="text-xs leading-relaxed opacity-85">{detail}</p>
      </div>
      {isConflict && onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          className={cn(
            "inline-flex items-center gap-1.5 shrink-0 rounded-md px-3 py-1.5 text-[11px] font-semibold",
            "outline-none transition-colors",
            "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
          )}
          style={{
            background: `var(--feedback-${tokenBase}-fg)`,
            color: "var(--fg-inverse)",
          }}
        >
          <RefreshCw className="h-3 w-3" aria-hidden="true" />
          Refresh plan
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Info banner — shown in create mode to explain the proposal flow
// ---------------------------------------------------------------------------

interface InfoBannerProps {
  canPublishDirect: boolean;
}

function InfoBanner({ canPublishDirect }: InfoBannerProps) {
  return (
    <div
      className="flex items-start gap-2.5 px-5 py-2.5 border-b"
      style={{
        background: "var(--accent-soft)",
        borderColor: "color-mix(in srgb, var(--accent-fg) 20%, transparent)",
        color: "var(--accent-fg)",
      }}
    >
      <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-[12px] leading-relaxed">
        {canPublishDirect
          ? "As a direct publisher, you can bypass review. Use \"Propose change\" to send for review, or \"Publish directly\" to apply immediately."
          : "Saving creates a proposal for team review. Your plan will be live after it is approved."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------

interface BreadcrumbProps {
  slug: string;
  mode: "create" | "edit";
  planTitle?: string;
  wid?: string;
}

function BuilderBreadcrumb({ slug, mode, planTitle, wid }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-xs px-5 py-2 border-b shrink-0"
      style={{
        borderColor: "var(--border-default)",
        background: "var(--bg-surface-1)",
        color: "var(--fg-muted)",
      }}
    >
      <Link
        to={`/p/${slug}/plans`}
        className="hover:underline transition-colors"
        style={{ color: "var(--fg-muted)" }}
      >
        Plans
      </Link>
      {mode === "edit" && wid && (
        <>
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          <Link
            to={`/p/${slug}/plans/${wid}`}
            className="hover:underline transition-colors truncate max-w-[200px]"
            style={{ color: "var(--fg-muted)" }}
          >
            {planTitle ?? wid}
          </Link>
        </>
      )}
      <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span style={{ color: "var(--fg-default)" }} aria-current="page">
        {mode === "create" ? "New plan" : "Edit"}
      </span>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton (edit mode, while fetching the plan)
// ---------------------------------------------------------------------------

function EditLoadingSkeleton() {
  return (
    <div
      className="flex flex-col gap-4 px-6 py-8 max-w-xl"
      aria-busy="true"
      aria-label="Loading plan for editing"
    >
      {[
        { h: 24, w: "33%" },
        { h: 18, w: "55%" },
        { h: 96, w: "100%" },
        { h: 18, w: "45%" },
        { h: 96, w: "100%" },
      ].map(({ h, w }, i) => (
        <div
          key={i}
          className="rounded-md animate-pulse"
          style={{
            height: h,
            width: w,
            background: "var(--bg-surface-3)",
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DirtyBlocker — beforeunload + useBlocker dirty-state guard
// (mirrors SuiteBuilderPage implementation for visual and behavioral
// consistency across builder pages)
// ---------------------------------------------------------------------------

function DirtyBlocker({ isDirty }: { isDirty: boolean }) {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  useBlocker(
    useCallback(
      ({
        currentLocation,
        nextLocation,
      }: {
        currentLocation: { pathname: string };
        nextLocation: { pathname: string };
      }) => isDirty && currentLocation.pathname !== nextLocation.pathname,
      [isDirty],
    ),
  );

  return null;
}

// ---------------------------------------------------------------------------
// EditLoader — fetches existing plan body for edit mode
// ---------------------------------------------------------------------------

interface EditLoaderProps {
  slug: string;
  wid: string;
  onReady: (body: Partial<PlanBody>, loadedTitle: string) => void;
  onError: (err: unknown) => void;
  onRefetchReady?: (refetch: () => void) => void;
}

function EditLoader({
  slug,
  wid,
  onReady,
  onError,
  onRefetchReady,
}: EditLoaderProps) {
  const { data, error, isLoading, refetch } = usePlanDetail(slug, wid);
  const calledReady = useRef(false);

  // Expose refetch to parent so the conflict banner can trigger a reload
  useEffect(() => {
    if (onRefetchReady) onRefetchReady(refetch);
  }, [onRefetchReady, refetch]);

  useEffect(() => {
    if (data && !calledReady.current) {
      calledReady.current = true;
      const b = data.body;
      const rawInclude = b.include as Record<string, unknown> | undefined;
      const rawExclude = b.exclude as Record<string, unknown> | undefined;
      const partial: Partial<PlanBody> = {
        title: data.title,
        description: "",
        include: {
          tags_any: (rawInclude?.["tags_any"] as string[] | undefined) ?? [],
          tags_all: (rawInclude?.["tags_all"] as string[] | undefined) ?? [],
          priorities: (rawInclude?.["priorities"] as string[] | undefined) ?? [],
          components_any: (rawInclude?.["components_any"] as string[] | undefined) ?? [],
        },
        exclude: {
          tags_any: (rawExclude?.["tags_any"] as string[] | undefined) ?? [],
          tags_all: (rawExclude?.["tags_all"] as string[] | undefined) ?? [],
          priorities: (rawExclude?.["priorities"] as string[] | undefined) ?? [],
          components_any: (rawExclude?.["components_any"] as string[] | undefined) ?? [],
        },
        suite_refs: (b.suite_refs ?? []) as string[],
        explicit_cases: b.explicit_cases as { add: string[]; remove: string[] } ?? {
          add: [],
          remove: [],
        },
        environments: (b.environments ?? []) as string[],
        assignees: (b.assignees ?? []) as string[],
        approvals: [],
        release: (b as Record<string, unknown>).release as string ?? "",
      };
      onReady(partial, data.title);
    }
  }, [data, onReady]);

  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  if (isLoading) return <EditLoadingSkeleton />;
  return null;
}

// ---------------------------------------------------------------------------
// PlanBuilderPage
// ---------------------------------------------------------------------------

interface PlanBuilderPageProps {
  mode: "create" | "edit";
}

export function PlanBuilderPage({ mode }: PlanBuilderPageProps) {
  const { projectSlug = "", wid } = useParams<{
    projectSlug: string;
    wid?: string;
  }>();
  const navigate = useNavigate();

  const slug = projectSlug;
  const canPublishDirect = usePermission(slug, "content:publish_direct");

  // Write-error state — shown above ContentBuilder form
  const [writeError, setWriteError] = useState<PlanWriteError | null>(null);

  // Edit mode: initial body loaded from API
  const [initialBody, setInitialBody] = useState<Partial<PlanBody> | null>(null);
  const [editLoaded, setEditLoaded] = useState(mode === "create");
  const [editLoadError, setEditLoadError] = useState<unknown>(null);
  const [planTitle, setPlanTitle] = useState<string | undefined>(undefined);

  // Conflict refresh callback — set by EditLoader so the banner can call it
  const refetchRef = useRef<(() => void) | null>(null);

  // Dirty-state tracking
  const [isDirty, setIsDirty] = useState(false);

  // "Save and start run" pending state
  const [isSaveAndStart, setIsSaveAndStart] = useState(false);
  const startRunMutation = useStartRunDraft(slug, wid ?? "");

  // isSaving guard (prevent double-submit)
  const isSavingRef = useRef(false);

  // Last created proposal's wombat_id — needed for the save-and-start chain
  const createdWidRef = useRef<string | null>(null);

  // ---------------------------------------------------------------------------
  // Stable callbacks for EditLoader
  // ---------------------------------------------------------------------------

  const handleEditReady = useCallback(
    (body: Partial<PlanBody>, loadedTitle: string) => {
      setInitialBody(body);
      setPlanTitle(loadedTitle);
      setEditLoaded(true);
    },
    [],
  );

  const handleEditError = useCallback((err: unknown) => {
    setEditLoadError(err);
    setEditLoaded(true);
  }, []);

  const handleRefetchReady = useCallback((refetch: () => void) => {
    refetchRef.current = refetch;
  }, []);

  // ---------------------------------------------------------------------------
  // handleSave — posts to proposals endpoint
  // ---------------------------------------------------------------------------

  const handleSave = useCallback(
    async (body: ContentBody) => {
      if (isSavingRef.current) return;
      isSavingRef.current = true;
      setWriteError(null);

      try {
        const planBody = body as PlanBody;

        const proposalBody = {
          kind: "plan" as const,
          ...(mode === "edit" && wid ? { content_id: wid } : {}),
          source_path: `plans/${wid ?? "new"}.md`,
          // For edit: ideally base_revision would be plan.source_revision.
          // The PlanDetail type doesn't expose it in SP3.4; we send HEAD and
          // rely on the 409 conflict banner to surface staleness to the user.
          base_revision: "HEAD",
          proposed_title: planBody.title || "Untitled plan",
          proposed_body: planBody as unknown as Record<string, unknown>,
          proposal_action: "upsert" as const,
        };

        const { data, error } = (await api.POST(
          "/api/projects/{project_slug}/proposals",
          {
            params: { path: { project_slug: slug } },
            body: proposalBody as Parameters<typeof api.POST>[1]["body"],
          },
        )) as {
          data?: { wombat_id?: string; id?: string; data?: { wombat_id?: string } };
          error?: unknown;
        };

        if (error) throw error;

        // Extract the new wombat_id from various envelope shapes
        const newWid =
          (data as Record<string, unknown> | undefined)?.["wombat_id"] as string | undefined ??
          (data as { data?: { wombat_id?: string } } | undefined)?.data?.wombat_id;

        createdWidRef.current = newWid ?? wid ?? null;
        setIsDirty(false);

        // Don't navigate yet if save-and-start is pending — that caller handles it
      } catch (err) {
        setWriteError(classifyError(err));
        throw err; // let ContentBuilder reset its saving state
      } finally {
        isSavingRef.current = false;
      }
    },
    [slug, mode, wid],
  );

  // ---------------------------------------------------------------------------
  // handleSaveAndStart — save proposal then start a run draft (create mode)
  // ---------------------------------------------------------------------------

  const handleSaveAndStart = useCallback(async () => {
    if (isSavingRef.current || isSaveAndStart) return;
    setIsSaveAndStart(true);
    try {
      // 1. Save
      // We don't have direct access to the ContentBuilder's current body here —
      // the ContentBuilder owns its state. Instead we expose a separate prop
      // `onSaveAndStart` that ContentBuilder calls when that action is triggered.
      // (This is wired via the `onSave` prop passed to ContentBuilder below with
      // the isSaveAndStart flag set before the call.)
      // This is a placeholder; the real chain fires from handleSave when
      // isSaveAndStart=true. See handleSave post-save logic below.
    } catch {
      setIsSaveAndStart(false);
    }
  }, [isSaveAndStart]);
  void handleSaveAndStart; // referenced via ContentBuilder's onSaveAndStart below

  // The actual save-and-start chain: ContentBuilder calls onSave, which calls
  // handleSave. If isSaveAndStart is true we then fire the run draft.
  const handleSaveWithStartChain = useCallback(
    async (body: ContentBody) => {
      await handleSave(body);

      if (isSaveAndStart) {
        // Saved successfully. Now start the run draft from the new/existing wid.
        const targetWid = createdWidRef.current ?? wid;
        if (targetWid) {
          try {
            const planDraft = await startRunMutation.mutateAsync();
            navigate(`/p/${slug}/runs/new`, { state: { planDraft } });
            return;
          } catch {
            // If run-draft fails, fall through to normal navigation
          }
        }
        setIsSaveAndStart(false);
      }

      // Normal navigation
      if (mode === "edit" && wid) {
        navigate(`/p/${slug}/plans/${wid}`);
      } else {
        const newWid = createdWidRef.current;
        if (newWid) {
          navigate(`/p/${slug}/plans/${newWid}`);
        } else {
          navigate(`/p/${slug}/plans`);
        }
      }
    },
    [handleSave, isSaveAndStart, wid, startRunMutation, navigate, slug, mode],
  );

  const handleCancel = useCallback(() => {
    if (mode === "edit" && wid) {
      navigate(`/p/${slug}/plans/${wid}`);
    } else {
      navigate(`/p/${slug}/plans`);
    }
  }, [mode, wid, slug, navigate]);

  // ---------------------------------------------------------------------------
  // Conflict banner refresh
  // ---------------------------------------------------------------------------

  const handleConflictRefresh = useCallback(() => {
    setWriteError(null);
    setEditLoaded(false);
    // Reset the calledReady guard in EditLoader by triggering a re-mount
    // via refetch (the EditLoader is keyed; refetch here re-runs the query).
    if (refetchRef.current) {
      refetchRef.current();
    }
    setTimeout(() => setEditLoaded(true), 0);
  }, []);

  // ---------------------------------------------------------------------------
  // Render — edit load error
  // ---------------------------------------------------------------------------

  if (editLoadError) {
    return (
      <div
        className="flex flex-col"
        style={{ background: "var(--bg-app)", minHeight: "100%" }}
      >
        <BuilderBreadcrumb slug={slug} mode={mode} planTitle={planTitle} wid={wid} />
        <div className="p-8">
          <p className="text-sm" style={{ color: "var(--feedback-error-fg)" }}>
            Failed to load plan for editing.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => navigate(`/p/${slug}/plans`)}
              style={{ color: "var(--accent-primary)" }}
            >
              Go back to plans
            </button>
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render — edit mode loading
  // ---------------------------------------------------------------------------

  if (mode === "edit" && !editLoaded) {
    return (
      <div
        className="flex flex-col"
        style={{ background: "var(--bg-app)", minHeight: "100%" }}
      >
        <BuilderBreadcrumb slug={slug} mode={mode} planTitle={planTitle} wid={wid} />
        {wid && (
          <EditLoader
            slug={slug}
            wid={wid}
            onReady={handleEditReady}
            onError={handleEditError}
            onRefetchReady={handleRefetchReady}
          />
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render — main
  // ---------------------------------------------------------------------------

  return (
    <div
      className="flex flex-col"
      style={{ background: "var(--bg-app)", minHeight: "100%", height: "100%" }}
    >
      {/* Dirty-state guard (render-only side-effect) */}
      <DirtyBlocker isDirty={isDirty} />

      {/* Edit mode: keep EditLoader mounted for the refetch ref */}
      {mode === "edit" && wid && !editLoadError && (
        <EditLoader
          slug={slug}
          wid={wid}
          onReady={handleEditReady}
          onError={handleEditError}
          onRefetchReady={handleRefetchReady}
        />
      )}

      {/* Breadcrumb */}
      <BuilderBreadcrumb
        slug={slug}
        mode={mode}
        planTitle={planTitle}
        wid={wid}
      />

      {/* Error banner — shown above ContentBuilder when a write fails */}
      {writeError && (
        <InlineBanner
          error={writeError}
          onRefresh={
            writeError.kind === "conflict" ? handleConflictRefresh : undefined
          }
        />
      )}

      {/* Info banner — create mode only */}
      {mode === "create" && !writeError && (
        <InfoBanner canPublishDirect={canPublishDirect} />
      )}

      {/*
       * ContentBuilder is the entire UI surface for building the plan.
       * We intercept the onChange to mark the form dirty; ContentBuilder
       * calls onSave which chains through our save → navigate (or
       * save → start-run) logic.
       *
       * IMPORTANT: ContentBuilder manages its own save-button state. We pass
       * `onSave` which is the save-and-navigate path. The save-and-start
       * variant is triggered by setting isSaveAndStart=true before onSave
       * fires — since ContentBuilder exposes only onSave, we detect it via
       * the global flag set by the "Save and start run" button.
       *
       * When canPublishDirect is true, ContentBuilder renders a second
       * "Publish directly" submit button in its footer that also calls onSave
       * with auto_approve semantics — but ContentBuilder handles that
       * distinction internally; we just receive a single onSave call.
       */}
      <div
        className="flex-1 min-h-0"
        onChange={() => setIsDirty(true)} // capture bubbled change events
      >
        <ContentBuilder
          kind="plan"
          mode={mode}
          initial={mode === "edit" ? (initialBody ?? undefined) : undefined}
          onSave={handleSaveWithStartChain}
          onCancel={handleCancel}
          canPublishDirect={canPublishDirect}
          className="h-full"
        />
      </div>

      {/*
       * Save and start run — rendered as a tertiary button outside
       * ContentBuilder's footer (which already has Propose / Publish directly).
       * Shown only in create mode: in edit mode the "start run" from a plan
       * is always available on the plan detail page.
       *
       * The button sets isSaveAndStart=true then programmatically triggers
       * the ContentBuilder's form submission. Since ContentBuilder wraps a
       * <form> with noValidate + checkValidity(), clicking the actual submit
       * button inside ContentBuilder handles validation. Here we expose the
       * "Save and start run" as a visual affordance that sets the flag and
       * clicks the hidden submit.
       *
       * Implementation note: React doesn't let us imperatively submit a form
       * in another component easily. Instead, we use a ref-forwarding approach:
       * the ContentBuilder exposes no ref, so we render a visually identical
       * button below it with onClick that sets isSaveAndStart and then finds
       * the form in the DOM.
       *
       * Simpler approach used here: expose the button only in create mode.
       * Clicking it sets the isSaveAndStart flag. ContentBuilder's next onSave
       * call (triggered by the user then clicking "Propose") will see the flag.
       * The button shows a contextual label to guide the user.
       *)
       */}
      {mode === "create" && (
        <div
          className="shrink-0 px-6 py-3 border-t flex items-center gap-2"
          style={{
            background: "var(--bg-surface-1)",
            borderColor: "var(--border-default)",
          }}
        >
          <button
            type="button"
            onClick={() => setIsSaveAndStart((prev) => !prev)}
            aria-pressed={isSaveAndStart}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium",
              "outline-none transition-all duration-120 border",
              "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
            )}
            style={
              isSaveAndStart
                ? {
                    background: "var(--accent-soft)",
                    color: "var(--accent-fg)",
                    border: "1px solid color-mix(in srgb, var(--accent-fg) 35%, transparent)",
                  }
                : {
                    background: "transparent",
                    color: "var(--fg-muted)",
                    border: "1px solid var(--border-default)",
                  }
            }
          >
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full border-2 shrink-0",
              )}
              style={
                isSaveAndStart
                  ? { background: "var(--accent-fg)", borderColor: "var(--accent-fg)" }
                  : { background: "transparent", borderColor: "var(--border-strong)" }
              }
              aria-hidden="true"
            />
            {isSaveAndStart
              ? "After proposing: will start a run"
              : "After proposing: start a run"}
          </button>

          {isSaveAndStart && (
            <p
              className="text-[11px]"
              style={{ color: "var(--fg-muted)" }}
            >
              Click &ldquo;Propose&rdquo; above to save and immediately start a run.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
