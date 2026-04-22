import { Globe, Lock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EnvironmentsTable } from "../components/EnvironmentsTable";
import { useActiveProject } from "@/features/projects/useActiveProject";
import { useContext } from "react";
import { SessionContext } from "@/features/auth/AuthProvider";

/**
 * Determine if the current user is an admin of the given project.
 *
 * There is no explicit "admin" role flag in the SP3.1/3.2 session model.
 * We use the same heuristic as CreateTokenDialog: a user is considered admin
 * if they hold the `content:publish_direct` permission on ANY project.
 * For the environment delete guard specifically we check for the active project
 * slug; if the user has `content:publish_direct` on this project they are admin.
 *
 * The backend enforces the real auth check — this gate only affects the UI.
 */
function useIsProjectAdmin(projectSlug: string | null): boolean {
  const session = useContext(SessionContext);
  const user = session?.user ?? null;
  if (!user || !projectSlug) return false;
  const perms = user.permissions_by_project[projectSlug];
  return Boolean(perms?.includes("content:publish_direct"));
}

/**
 * SettingsEnvironmentsPage — admin CRUD for per-project test environments.
 *
 * Rendered inside SettingsShell at /settings/environments.
 * Uses the currently active project (resolved from last_project_slug in
 * localStorage, set when the user navigates within a project).
 *
 * Non-admin users see the table in read-only mode with no add/delete controls.
 * Admin users get an inline add row and per-row delete (with confirm dialog).
 *
 * Note: environments are immutable after creation (no PATCH endpoint in the
 * backend as of SP3.3). Rename is deferred as a future follow-up.
 *
 * States implemented:
 *   - Loading: skeleton rows
 *   - Empty: EmptyState with optional Add button
 *   - Error: ErrorState with Retry
 *   - Normal: bordered table with inline add + delete
 *   - No active project: informational notice
 */
export function SettingsEnvironmentsPage() {
  const { projectSlug, project } = useActiveProject();
  const isAdmin = useIsProjectAdmin(projectSlug);

  // ---- No active project ----
  if (!projectSlug || !project) {
    return (
      <div className="flex flex-col h-full">
        <PageHeader
          title="Environments"
          subtitle="Manage named environments for test runs"
        />
        <div className="p-6 max-w-2xl">
          <NoProjectNotice />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Environments"
        subtitle={`Named environments for ${project.name} test runs (e.g. Staging, Production)`}
        actions={
          !isAdmin ? (
            <ReadOnlyBadge />
          ) : undefined
        }
      />

      <div className="p-6 max-w-2xl">
        {/* Admin hint / read-only info */}
        {!isAdmin && (
          <div
            className="mb-4 flex items-start gap-2.5 rounded-lg px-4 py-3 text-xs"
            style={{
              background: "var(--feedback-info-bg)",
              border: "1px solid color-mix(in srgb, var(--feedback-info-fg) 20%, transparent)",
              color: "var(--feedback-info-fg)",
            }}
          >
            <Lock
              className="h-3.5 w-3.5 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <span>
              You have read-only access to environments. Contact a project admin
              to add or remove environments.
            </span>
          </div>
        )}

        <EnvironmentsTable projectSlug={projectSlug} isAdmin={isAdmin} />

        {/* Rename deferred notice — visible to admins only */}
        {isAdmin && (
          <p
            className="mt-4 text-[11px] leading-relaxed"
            style={{ color: "var(--fg-disabled)" }}
          >
            Renaming environments is not yet supported. To rename, delete the
            old environment and create a new one. Existing runs that referenced
            the deleted environment will lose their environment association.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ReadOnlyBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase"
      style={{
        background: "var(--bg-surface-2)",
        color: "var(--fg-muted)",
        border: "1px solid var(--border-default)",
      }}
    >
      <Lock className="h-3 w-3" aria-hidden="true" />
      Read-only
    </span>
  );
}

function NoProjectNotice() {
  return (
    <div
      className="flex flex-col items-start gap-3 px-5 py-6 max-w-md"
    >
      <div
        className="flex flex-col gap-1.5 pl-4"
        style={{ borderLeft: "3px solid var(--border-strong)" }}
      >
        <div
          className="flex items-center gap-2"
          style={{ color: "var(--fg-muted)" }}
        >
          <span
            className="flex h-7 w-7 items-center justify-center rounded-md shrink-0"
            style={{ background: "var(--bg-surface-2)" }}
          >
            <Globe className="h-4 w-4" aria-hidden="true" />
          </span>
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--fg-default)" }}
          >
            No project selected
          </span>
        </div>
        <p
          className="text-xs leading-relaxed"
          style={{ color: "var(--fg-muted)" }}
        >
          Navigate to a project first, then return to Settings to manage its
          environments.
        </p>
      </div>
    </div>
  );
}
