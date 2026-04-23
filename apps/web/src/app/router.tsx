import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./layouts/AppShell";
import { PublicLayout } from "./layouts/PublicLayout";
import { LoginPage } from "@/features/auth/LoginPage";
import { RegisterPage } from "@/features/auth/RegisterPage";
import { ProjectPickerPage } from "@/features/projects/ProjectPickerPage";
import { LibraryPage } from "@/features/library/LibraryPage";
import { TestcaseDetailPage } from "@/features/library/TestcaseDetailPage";
import { SharedStepListPage } from "@/features/shared-steps/SharedStepListPage";
import { SharedStepDetailPage } from "@/features/shared-steps/SharedStepDetailPage";
import { StoryListPage } from "@/features/stories/StoryListPage";
import { StoryDetailPage } from "@/features/stories/StoryDetailPage";
import { SearchPage } from "@/features/search/SearchPage";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { ProfilePage } from "@/features/settings/ProfilePage";
import { TokensPage } from "@/features/settings/TokensPage";
import { ThemePage } from "@/features/settings/ThemePage";
import { ForbiddenPage } from "@/features/errors/ForbiddenPage";
import { NotFoundPage } from "@/features/errors/NotFoundPage";
// SP3.3 — Runs pages (eager; only RunExecutePage is lazy)
import { RunsPage } from "@/features/runs/pages/RunsPage";
import { RunCreatePage } from "@/features/runs/pages/RunCreatePage";
import { RunDetailPage } from "@/features/runs/pages/RunDetailPage";
import { SettingsEnvironmentsPage } from "@/features/runs/pages/SettingsEnvironmentsPage";

// SP3.4 — Plans, Suites, Dashboards are route-split to keep the main bundle
// under the 250 KB warning threshold.  Recharts (pulled in by dashboard
// widgets) and ContentBuilder are the primary size contributors; moving these
// routes behind React.lazy() removes them from the initial parse budget.
const ProjectDashboardPage = lazy(() =>
  import("@/features/dashboards/ProjectDashboardPage").then((m) => ({
    default: m.ProjectDashboardPage,
  })),
);
const PlansListPage = lazy(() =>
  import("@/features/plans/PlansListPage").then((m) => ({
    default: m.PlansListPage,
  })),
);
const PlanDetailPage = lazy(() =>
  import("@/features/plans/PlanDetailPage").then((m) => ({
    default: m.PlanDetailPage,
  })),
);
const PlanBuilderPage = lazy(() =>
  import("@/features/plans/PlanBuilderPage").then((m) => ({
    default: m.PlanBuilderPage,
  })),
);
const PlanDashboardPage = lazy(() =>
  import("@/features/plans/PlanDashboardPage").then((m) => ({
    default: m.PlanDashboardPage,
  })),
);
const SuiteTreePage = lazy(() =>
  import("@/features/suites/SuiteTreePage").then((m) => ({
    default: m.SuiteTreePage,
  })),
);
const SuiteDetailPage = lazy(() =>
  import("@/features/suites/SuiteDetailPage").then((m) => ({
    default: m.SuiteDetailPage,
  })),
);
const SuiteBuilderPage = lazy(() =>
  import("@/features/suites/SuiteBuilderPage").then((m) => ({
    default: m.SuiteBuilderPage,
  })),
);

// SP3.3 — Runner is code-split; must not appear in the main bundle.
const LazyRunExecutePage = lazy(
  () => import("@/features/runs/pages/RunExecutePage"),
);

// Lazy-loaded proposal feature pages (CodeMirror adds significant chunk size)
const ApprovalsInboxPage = lazy(() =>
  import("@/features/proposals/ApprovalsInboxPage").then((m) => ({
    default: m.ApprovalsInboxPage,
  })),
);
const ReviewDetailPage = lazy(() =>
  import("@/features/proposals/ReviewDetailPage").then((m) => ({
    default: m.ReviewDetailPage,
  })),
);
const EditForm = lazy(() =>
  import("@/features/proposals/EditForm").then((m) => ({ default: m.EditForm })),
);
const ConflictWorkspace = lazy(() =>
  import("@/features/proposals/ConflictWorkspace").then((m) => ({
    default: m.ConflictWorkspace,
  })),
);

function ProposalFallback() {
  return (
    <div
      className="flex flex-col gap-4 p-6 max-w-3xl"
      aria-busy="true"
      aria-label="Loading"
    >
      {[48, 32, 280].map((h, i) => (
        <div
          key={i}
          className="rounded-md animate-pulse"
          style={{
            height: h,
            background: "var(--bg-surface-2)",
            border: "1px solid var(--border-default)",
          }}
        />
      ))}
    </div>
  );
}

/**
 * Sp34Fallback — loading skeleton used for SP3.4 route-split pages
 * (dashboards, plans, suites).  A sparse three-row skeleton keeps the
 * AppShell chrome visible and gives a sense of the incoming layout.
 */
function Sp34Fallback() {
  return (
    <div
      className="flex flex-col gap-4 p-6"
      aria-busy="true"
      aria-label="Loading"
    >
      {[32, 120, 220].map((h, i) => (
        <div
          key={i}
          className="rounded-md animate-pulse"
          style={{
            height: h,
            background: "var(--bg-surface-2)",
            border: "1px solid var(--border-default)",
          }}
        />
      ))}
    </div>
  );
}

/**
 * RunnerSpinner — minimal full-screen loading state for the lazy-loaded Runner.
 * No AppShell chrome here; the runner renders outside the normal layout.
 */
function RunnerSpinner() {
  return (
    <div
      className="flex h-screen w-screen items-center justify-center"
      aria-busy="true"
      aria-label="Loading runner"
      style={{ background: "var(--bg-app)" }}
    >
      <div
        className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "var(--border-strong)", borderTopColor: "transparent" }}
        role="presentation"
      />
    </div>
  );
}

export function Router() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      {/* SP3.3: Runner is full-screen — rendered OUTSIDE AppShell (no sidebar/header). */}
      <Route
        path="/p/:projectSlug/runs/:id/execute"
        element={
          <Suspense fallback={<RunnerSpinner />}>
            <LazyRunExecutePage />
          </Suspense>
        }
      />

      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectPickerPage />} />

        <Route path="/p/:projectSlug">
          {/* SP3.4: project home is now the Dashboard (lazy — recharts widget) */}
          <Route
            index
            element={
              <Suspense fallback={<Sp34Fallback />}>
                <ProjectDashboardPage />
              </Suspense>
            }
          />

          {/* SP3.4: Plans (lazy — ContentBuilder + recharts via PlanDashboardPage) */}
          <Route
            path="plans"
            element={
              <Suspense fallback={<Sp34Fallback />}>
                <PlansListPage />
              </Suspense>
            }
          />
          <Route
            path="plans/new"
            element={
              <Suspense fallback={<Sp34Fallback />}>
                <PlanBuilderPage mode="create" />
              </Suspense>
            }
          />
          <Route
            path="plans/:wid"
            element={
              <Suspense fallback={<Sp34Fallback />}>
                <PlanDetailPage />
              </Suspense>
            }
          />
          <Route
            path="plans/:wid/edit"
            element={
              <Suspense fallback={<Sp34Fallback />}>
                <PlanBuilderPage mode="edit" />
              </Suspense>
            }
          />
          <Route
            path="plans/:wid/dashboard"
            element={
              <Suspense fallback={<Sp34Fallback />}>
                <PlanDashboardPage />
              </Suspense>
            }
          />

          {/* SP3.4: Suites (lazy — SuiteTree + ContentBuilder) */}
          <Route
            path="suites"
            element={
              <Suspense fallback={<Sp34Fallback />}>
                <SuiteTreePage />
              </Suspense>
            }
          />
          <Route
            path="suites/new"
            element={
              <Suspense fallback={<Sp34Fallback />}>
                <SuiteBuilderPage mode="create" />
              </Suspense>
            }
          />
          <Route
            path="suites/:wid"
            element={
              <Suspense fallback={<Sp34Fallback />}>
                <SuiteDetailPage />
              </Suspense>
            }
          />
          <Route
            path="suites/:wid/edit"
            element={
              <Suspense fallback={<Sp34Fallback />}>
                <SuiteBuilderPage mode="edit" />
              </Suspense>
            }
          />

          <Route path="library" element={<LibraryPage />} />
          <Route path="library/:wombatId" element={<TestcaseDetailPage />} />
          <Route path="shared-steps" element={<SharedStepListPage />} />
          <Route path="shared-steps/:wombatId" element={<SharedStepDetailPage />} />
          <Route path="stories" element={<StoryListPage />} />
          <Route path="stories/:wombatId" element={<StoryDetailPage />} />
          <Route path="search" element={<SearchPage />} />

          {/* SP3.3 Runs — Execute is registered outside AppShell above */}
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/new" element={<RunCreatePage />} />
          <Route path="runs/:id" element={<RunDetailPage />} />

          {/* SP3.2 Proposals */}
          <Route
            path="approvals"
            element={
              <Suspense fallback={<ProposalFallback />}>
                <ApprovalsInboxPage />
              </Suspense>
            }
          />
          <Route
            path="approvals/:proposalId"
            element={
              <Suspense fallback={<ProposalFallback />}>
                <ReviewDetailPage />
              </Suspense>
            }
          />
          <Route
            path="approvals/:proposalId/rebase"
            element={
              <Suspense fallback={<ProposalFallback />}>
                <ConflictWorkspace />
              </Suspense>
            }
          />
          <Route
            path=":kind/:wombatId/edit"
            element={
              <Suspense fallback={<ProposalFallback />}>
                <EditForm />
              </Suspense>
            }
          />
          <Route
            path=":kind/new"
            element={
              <Suspense fallback={<ProposalFallback />}>
                <EditForm />
              </Suspense>
            }
          />
        </Route>

        <Route path="/settings" element={<SettingsShell />}>
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="tokens" element={<TokensPage />} />
          <Route path="theme" element={<ThemePage />} />
          {/* SP3.3 */}
          <Route path="environments" element={<SettingsEnvironmentsPage />} />
        </Route>
      </Route>

      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
