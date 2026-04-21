import { Outlet } from "react-router-dom";

/**
 * PublicLayout: centered narrow column for auth screens (login, register).
 */
export function PublicLayout() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[color:var(--bg-app)] px-4 py-10 text-[color:var(--fg-default)]">
      <div className="w-full max-w-md">
        <Outlet />
      </div>
    </div>
  );
}
