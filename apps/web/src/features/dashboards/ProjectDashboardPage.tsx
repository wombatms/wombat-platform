/**
 * ProjectDashboardPage — project home / dashboard route (SP3.4 Task 51).
 *
 * Route: /p/:projectSlug (the project home)
 *
 * Design decisions (frontend-design skill):
 * - Uses the SP3.1 PageHeader primitive for the sticky masthead (project name
 *   as title). No custom "PageShell" abstraction needed — the existing pattern
 *   across library/runs/suites pages is PageHeader + scrollable main content.
 * - Loading state: skeleton title placeholder in the header strip instead of a
 *   full-page spinner; widgets render their own skeleton frames.
 * - Empty state detection: usePlansList returning [] is the cheapest proxy for
 *   "nothing created yet". When plans exist, individual widget empty states
 *   explain their own missing data.
 * - Welcome empty state: editorial left-rule callout with "Create plan" and
 *   "Create run" CTAs. Tone is confident and sparse — no illustration, no
 *   centered spinner energy. Anchored to the top of the content area.
 * - useActiveProject resolves projectSlug → Project (name, id). The project id
 *   is the scope_id for project-scoped widgets. While loading, scopeId is ""
 *   which keeps widgets disabled (useWidget has `enabled: Boolean(slug && widget)`
 *   and widgets guard on empty scopeId).
 */

import { useNavigate, useParams } from "react-router-dom";
import { LayoutDashboard, Plus, Play } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useActiveProject } from "@/features/projects/useActiveProject";
import { usePlansList } from "@/features/plans/hooks";
import { DashboardPage } from "./DashboardPage";

// ---------------------------------------------------------------------------
// Loading header title placeholder
// ---------------------------------------------------------------------------

function TitleSkeleton() {
  return (
    <Skeleton
      className="h-4 w-36 rounded"
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// Welcome / empty state
// ---------------------------------------------------------------------------

interface WelcomeStateProps {
  slug: string;
  projectName: string;
}

function WelcomeState({ slug, projectName }: WelcomeStateProps) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col gap-5 px-5 py-6 max-w-lg">
      {/* Icon + heading strip */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: "var(--accent-soft)",
            color: "var(--accent-fg)",
          }}
          aria-hidden="true"
        >
          <LayoutDashboard className="h-5 w-5" />
        </div>
        <div className="flex flex-col gap-0.5">
          <h2
            className="text-sm font-semibold leading-tight"
            style={{ color: "var(--fg-default)" }}
          >
            Welcome to {projectName}
          </h2>
          <p className="text-xs" style={{ color: "var(--fg-muted)" }}>
            No activity yet. Start by creating a plan or running a test.
          </p>
        </div>
      </div>

      {/* Left-rule callout */}
      <div
        className="flex flex-col gap-3 pl-4 py-1"
        style={{ borderLeft: "3px solid var(--border-strong)" }}
      >
        <p className="text-xs leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          Plans let you define which test cases to run together. Once you have a
          plan, you can execute a run and see results here on the dashboard.
        </p>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => navigate(`/p/${slug}/plans/new`)}
            className="gap-1.5"
            style={{
              background: "var(--accent-primary)",
              color: "var(--fg-inverse)",
            }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Create plan
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(`/p/${slug}/runs/new`)}
            className="gap-1.5"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Create run
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectDashboardPage
// ---------------------------------------------------------------------------

export function ProjectDashboardPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();

  // useActiveProject resolves the slug → project detail (name, id).
  // The hook reads from the projects list cache, which is populated by the
  // app shell's initial fetch — no additional network request needed here.
  const { project, isLoading: projectLoading } = useActiveProject();

  // usePlansList: empty result is the cheapest proxy for "nothing created yet".
  // Plans being present doesn't guarantee run data exists, but the widget
  // empty states handle that case gracefully. We only show the welcome state
  // when the project appears completely new (no plans at all).
  const { data: plans, isLoading: plansLoading } = usePlansList(projectSlug);
  const isNewProject =
    !plansLoading && Array.isArray(plans) && plans.length === 0;

  const projectName = project?.name ?? projectSlug;

  // project.id is the scope_id for project-scoped widget queries.
  // Fallback to "" keeps widgets disabled while loading (useWidget guards on
  // Boolean(slug && widget) — but project.id is different from slug, so we
  // pass it separately as scopeId).
  const scopeId = project?.id ?? "";

  return (
    <div className="flex flex-col h-full" style={{ overflowY: "auto" }}>
      {/* Sticky page header */}
      <PageHeader
        title={projectLoading ? "" : projectName}
        subtitle={projectLoading ? undefined : "Overview"}
        actions={
          projectLoading ? (
            <TitleSkeleton />
          ) : undefined
        }
      />

      {/* Content area */}
      <main className="flex-1 px-5 py-5">
        {isNewProject ? (
          <WelcomeState slug={projectSlug} projectName={projectName} />
        ) : (
          <DashboardPage scope="project" scopeId={scopeId} />
        )}
      </main>
    </div>
  );
}
