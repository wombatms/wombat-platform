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

export function Router() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

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
        </Route>

        <Route path="/settings" element={<SettingsShell />}>
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="tokens" element={<TokensPage />} />
          <Route path="theme" element={<ThemePage />} />
        </Route>
      </Route>

      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
