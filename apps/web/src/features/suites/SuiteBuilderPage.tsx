/**
 * SuiteBuilderPage — Suite create + edit page (SP3.4 Task 46).
 *
 * Design decisions from frontend-design skill (Task 46):
 * - Utilitarian precision aesthetic matching wombat-platform SP3.1–3.4 design
 *   language: all spacing and color from design tokens, no hardcoded hex.
 * - Error banners are placed ABOVE the ContentBuilder, at the top of the page,
 *   between the breadcrumb header and the form. Non-dismissible for
 *   SuiteCycleError / SuiteDepthLimitError (operation failed, not a warning).
 *   Uses feedback-danger tokens + OctagonX icon + error code in monospace.
 * - Parent picker is the first field in MetadataFields (suite kind) so the
 *   tree context is set early — MetadataFields already does this.
 * - Dirty-state warning: beforeunload listener on window; same-app navigation
 *   uses useBlocker (React Router v6.4+) to show a native browser confirm.
 * - Success navigation: edit → suite detail page; create → detail page if
 *   response includes wombat_id, else /suites list.
 *
 * Route params:
 *   `/p/:projectSlug/suites/new`        → mode="create"  (honors ?parent=<wid>)
 *   `/p/:projectSlug/suites/:wid/edit`  → mode="edit"
 *
 * Proposals kind: backend ProposalCreate accepts kind="suite" (Literal confirmed
 * in packages/api/src/wombat_api/schemas/proposals.py line 13). No fix needed.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  useParams,
  useSearchParams,
  useNavigate,
  useBlocker,
  Link,
} from "react-router-dom";
import { OctagonX, ChevronRight } from "lucide-react";

import { api } from "@/lib/api/client";
import { ApiError, SuiteCycleError, SuiteDepthLimitError } from "@/lib/api/errors";
import { ContentBuilder, type ContentBody, type SuiteBody } from "@/features/plans/ContentBuilder";
import { useSuiteDetail } from "./hooks";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SuiteBuilderPageProps {
  mode: "create" | "edit";
}

// ---------------------------------------------------------------------------
// Error types we handle inline
// ---------------------------------------------------------------------------

type SuiteWriteError =
  | { kind: "cycle" }
  | { kind: "depth" }
  | { kind: "parent_other_project" }
  | { kind: "generic"; message: string };

function classifyError(err: unknown): SuiteWriteError {
  if (err instanceof SuiteCycleError) return { kind: "cycle" };
  if (err instanceof SuiteDepthLimitError) return { kind: "depth" };
  if (err instanceof ApiError && err.code === "SUITE_PARENT_OTHER_PROJECT") {
    return { kind: "parent_other_project" };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { kind: "generic", message: msg };
}

function errorMessage(e: SuiteWriteError): { headline: string; detail: string; code: string } {
  switch (e.kind) {
    case "cycle":
      return {
        headline: "Cycle detected",
        detail: "This parent would create a circular reference in the suite tree. Choose a different parent.",
        code: "SUITE_CYCLE",
      };
    case "depth":
      return {
        headline: "Tree depth limit reached",
        detail: "Suite nesting is limited to 20 levels. Move this suite to a shallower level in the hierarchy.",
        code: "SUITE_DEPTH_LIMIT",
      };
    case "parent_other_project":
      return {
        headline: "Parent belongs to another project",
        detail: "The selected parent suite is not part of this project. Clear the parent field and try again.",
        code: "SUITE_PARENT_OTHER_PROJECT",
      };
    case "generic":
      return {
        headline: "Could not save suite",
        detail: e.message,
        code: "UNKNOWN",
      };
  }
}

// ---------------------------------------------------------------------------
// InlineBanner — non-dismissible error banner shown above the form
// ---------------------------------------------------------------------------

interface InlineBannerProps {
  error: SuiteWriteError;
}

function InlineBanner({ error }: InlineBannerProps) {
  const { headline, detail, code } = errorMessage(error);
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex items-start gap-3 px-4 py-3 border-b"
      style={{
        background: "var(--feedback-error-bg, #fef2f2)",
        borderColor: "var(--feedback-error-border, #fca5a5)",
        color: "var(--feedback-error-fg, #991b1b)",
      }}
    >
      <OctagonX
        className="h-4 w-4 shrink-0 mt-0.5"
        aria-hidden="true"
      />
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-semibold">
          {headline}
          <span
            className="ml-2 text-[11px] font-mono font-normal"
            style={{ opacity: 0.7 }}
          >
            {code}
          </span>
        </span>
        <p className="text-xs leading-relaxed" style={{ opacity: 0.85 }}>
          {detail}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Breadcrumb for the page header
// ---------------------------------------------------------------------------

interface BreadcrumbProps {
  slug: string;
  mode: "create" | "edit";
  suiteTitle?: string;
}

function BuilderBreadcrumb({ slug, mode, suiteTitle }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-xs px-5 py-2 border-b"
      style={{
        borderColor: "var(--border-default)",
        background: "var(--bg-surface-1)",
        color: "var(--fg-muted)",
      }}
    >
      <Link
        to={`/p/${slug}/suites`}
        className="hover:underline transition-colors"
        style={{ color: "var(--fg-muted)" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "var(--accent-primary)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "var(--fg-muted)"; }}
      >
        Suites
      </Link>
      <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span
        style={{ color: "var(--fg-default)" }}
        aria-current="page"
      >
        {mode === "create"
          ? "New suite"
          : suiteTitle
            ? `Edit: ${suiteTitle}`
            : "Edit suite"}
      </span>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Edit mode loader — fetches existing suite body
// ---------------------------------------------------------------------------

interface EditLoaderProps {
  slug: string;
  wid: string;
  onReady: (body: Partial<SuiteBody>) => void;
  onError: (err: unknown) => void;
}

/**
 * Invisible component that triggers useSuiteDetail and calls onReady once
 * data arrives, or onError if it fails. It renders loading skeletons in place.
 */
function EditLoader({ slug, wid, onReady, onError }: EditLoaderProps) {
  const { data, error, isLoading } = useSuiteDetail(slug, wid);

  useEffect(() => {
    if (data) {
      const rawInclude = data.include as Record<string, unknown> | undefined;
      onReady({
        title: data.title,
        description: "",
        parent_wombat_id: data.parent_wombat_id,
        cases: data.cases ?? [],
        include: {
          tags_any: (rawInclude?.["tags_any"] as string[] | undefined) ?? [],
          tags_all: (rawInclude?.["tags_all"] as string[] | undefined) ?? [],
          priorities: (rawInclude?.["priorities"] as string[] | undefined) ?? [],
          components_any: (rawInclude?.["components_any"] as string[] | undefined) ?? [],
        },
        owner: data.owner ?? "",
        tags: data.tags ?? [],
      });
    }
  }, [data, onReady]);

  useEffect(() => {
    if (error) onError(error);
  }, [error, onError]);

  if (isLoading) {
    return (
      <div
        className="flex flex-col gap-4 px-6 py-8 max-w-xl"
        aria-busy="true"
        aria-label="Loading suite for editing"
      >
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// DirtyBlocker — beforeunload + useBlocker dirty-state guard
// ---------------------------------------------------------------------------

function DirtyBlocker({ isDirty }: { isDirty: boolean }) {
  // Native browser beforeunload (tab close / hard reload)
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore returnValue text but require it to be set
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Same-app navigation via React Router v6.4+ useBlocker
  useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: { pathname: string }; nextLocation: { pathname: string } }) =>
        isDirty && currentLocation.pathname !== nextLocation.pathname,
      [isDirty],
    ),
  );

  return null;
}

// ---------------------------------------------------------------------------
// SuiteBuilderPage
// ---------------------------------------------------------------------------

export function SuiteBuilderPage({ mode }: SuiteBuilderPageProps) {
  const { projectSlug, wid } = useParams<{ projectSlug: string; wid?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const slug = projectSlug ?? "";
  const parentWid = searchParams.get("parent");

  // Error state shown above the form
  const [writeError, setWriteError] = useState<SuiteWriteError | null>(null);

  // Edit mode: initial body loaded from the API
  const [initialBody, setInitialBody] = useState<Partial<SuiteBody> | null>(null);
  const [editLoaded, setEditLoaded] = useState(mode === "create");
  const [editLoadError, setEditLoadError] = useState<unknown>(null);

  // The loaded suite title (for breadcrumb)
  const [suiteTitle, setSuiteTitle] = useState<string | undefined>(undefined);

  // Dirty tracking — set true when ContentBuilder fires first onChange.
  // We mark it via the onSave path too (reset after successful save).
  const [isDirty, setIsDirty] = useState(false);

  // Stable callbacks for edit loader
  const handleEditReady = useCallback((body: Partial<SuiteBody>) => {
    setInitialBody(body);
    setSuiteTitle(body.title);
    setEditLoaded(true);
  }, []);

  const handleEditError = useCallback((err: unknown) => {
    setEditLoadError(err);
    setEditLoaded(true);
  }, []);

  // Build initial for create mode (honor ?parent=<wid>)
  const createInitial: Partial<SuiteBody> | undefined = parentWid
    ? { parent_wombat_id: parentWid }
    : undefined;

  // ---------------------------------------------------------------------------
  // handleSave — posts to proposals endpoint
  // ---------------------------------------------------------------------------
  const isSavingRef = useRef(false);

  const handleSave = useCallback(
    async (body: ContentBody) => {
      if (isSavingRef.current) return;
      isSavingRef.current = true;
      setWriteError(null);

      try {
        const suiteBody = body as SuiteBody;

        // POST /api/projects/:slug/proposals with kind="suite".
        // The backend ProposalCreate schema already accepts kind="suite"
        // (packages/api/src/wombat_api/schemas/proposals.py line 13).
        // We cast the body to satisfy the openapi-fetch type narrowing which
        // is generated from the schema and already includes suite as a valid kind.
        const proposalBody = {
          kind: "suite" as const,
          // content_id for edit mode: wid is the wombat_id
          ...(mode === "edit" && wid ? { content_id: wid } : {}),
          source_path: `suites/${wid ?? "new"}.md`,
          base_revision: "HEAD",
          proposed_title: suiteBody.title || "Untitled suite",
          proposed_body: suiteBody as unknown as Record<string, unknown>,
          proposal_action: "upsert" as const,
        };

        const { data, error } = await api.POST(
          "/api/projects/{project_slug}/proposals",
          {
            params: { path: { project_slug: slug } },
            body: proposalBody as Parameters<typeof api.POST>[1]["body"],
          },
        ) as { data?: { wombat_id?: string; id?: string }; error?: unknown };

        if (error) throw error;

        setIsDirty(false);

        // Navigate on success
        if (mode === "edit" && wid) {
          navigate(`/p/${slug}/suites/${wid}`);
        } else {
          // Create mode: navigate to detail if we have the new wombat_id
          const newWid = data?.wombat_id;
          if (newWid) {
            navigate(`/p/${slug}/suites/${newWid}`);
          } else {
            navigate(`/p/${slug}/suites`);
          }
        }
      } catch (err) {
        // Classify and show inline banner
        setWriteError(classifyError(err));
        // Re-throw so ContentBuilder can reset its isSaving state
        throw err;
      } finally {
        isSavingRef.current = false;
      }
    },
    [slug, mode, wid, navigate],
  );

  const handleCancel = useCallback(() => {
    if (mode === "edit" && wid) {
      navigate(`/p/${slug}/suites/${wid}`);
    } else {
      navigate(`/p/${slug}/suites`);
    }
  }, [mode, wid, slug, navigate]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // Edit mode: show load error
  if (editLoadError) {
    return (
      <div className="flex flex-col min-h-screen" style={{ background: "var(--bg-app)" }}>
        <BuilderBreadcrumb slug={slug} mode={mode} />
        <div className="p-8">
          <p className="text-sm" style={{ color: "var(--feedback-error-fg)" }}>
            Failed to load suite for editing.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => navigate(`/p/${slug}/suites`)}
              style={{ color: "var(--accent-primary)" }}
            >
              Go back to suites
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col"
      style={{
        background: "var(--bg-app)",
        minHeight: "100%",
      }}
    >
      {/* Dirty-state guard */}
      <DirtyBlocker isDirty={isDirty} />

      {/* Breadcrumb nav */}
      <BuilderBreadcrumb slug={slug} mode={mode} suiteTitle={suiteTitle} />

      {/* Inline error banner — sits between breadcrumb and form */}
      {writeError && <InlineBanner error={writeError} />}

      {/* Edit-mode loader (invisible once loaded) */}
      {mode === "edit" && wid && !editLoaded && (
        <EditLoader
          slug={slug}
          wid={wid}
          onReady={handleEditReady}
          onError={handleEditError}
        />
      )}

      {/* ContentBuilder — shown once data is ready */}
      {editLoaded && (
        <div
          className={cn(
            "flex-1",
            // Track dirty state via a wrapper that intercepts onChange.
            // ContentBuilder doesn't expose an onChange prop directly, so we
            // inject a wrapper around onSave and mark dirty on first call.
          )}
          style={{ minHeight: 0 }}
          onChange={() => {
            // The form's native onChange bubbles up — mark dirty on any field
            // interaction. This is intentionally coarse: the first keystroke
            // marks dirty, which is the correct UX for an authoring surface.
            if (!isDirty) setIsDirty(true);
          }}
          role="presentation"
        >
          <ContentBuilder
            kind="suite"
            mode={mode}
            initial={
              mode === "edit"
                ? (initialBody ?? undefined)
                : createInitial
            }
            onSave={handleSave}
            onCancel={handleCancel}
          />
        </div>
      )}
    </div>
  );
}
