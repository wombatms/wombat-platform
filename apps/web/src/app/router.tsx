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
          <Route index element={<Navigate to="library" replace />} />
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
