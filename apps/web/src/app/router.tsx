import { Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "./layouts/AppShell";
import { PublicLayout } from "./layouts/PublicLayout";
import { LoginPage } from "@/features/auth/LoginPage";
import { RegisterPage } from "@/features/auth/RegisterPage";

function PlaceholderPage({ name }: { name: string }) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">{name}</h1>
      <p className="text-sm text-[color:var(--fg-muted)]">
        Placeholder — will be implemented in a later task.
      </p>
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
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<PlaceholderPage name="Project picker" />} />
        <Route path="/p/:projectSlug">
          <Route index element={<Navigate to="library" replace />} />
          <Route path="library" element={<PlaceholderPage name="Test Library" />} />
          <Route path="library/:wombatId" element={<PlaceholderPage name="Testcase Detail" />} />
          <Route path="shared-steps" element={<PlaceholderPage name="Shared Steps" />} />
          <Route
            path="shared-steps/:wombatId"
            element={<PlaceholderPage name="Shared Step Detail" />}
          />
          <Route path="stories" element={<PlaceholderPage name="Stories" />} />
          <Route path="stories/:wombatId" element={<PlaceholderPage name="Story Detail" />} />
          <Route path="search" element={<PlaceholderPage name="Search" />} />
        </Route>
        <Route path="/settings">
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<PlaceholderPage name="Profile" />} />
          <Route path="tokens" element={<PlaceholderPage name="API Tokens" />} />
          <Route path="theme" element={<PlaceholderPage name="Theme" />} />
        </Route>
      </Route>
      <Route path="/403" element={<PlaceholderPage name="Forbidden" />} />
      <Route path="/404" element={<PlaceholderPage name="Not Found" />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
