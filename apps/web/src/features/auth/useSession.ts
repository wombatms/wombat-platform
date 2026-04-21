import { useContext } from "react";
import { SessionContext, type SessionContextValue } from "./AuthProvider";

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within an AuthProvider");
  }
  return ctx;
}

/**
 * Returns true if the current user has the given permission on the given
 * project. Falls back to false when the session is loading or anonymous.
 *
 * Example:
 *   const canPublishDirect = usePermission("alpha", "content:publish_direct");
 *
 * The permission string matches the backend's Permission enum values:
 *   "content:propose"         — can create/update/withdraw proposals
 *   "content:publish_direct"  — can approve or direct-publish
 */
export function usePermission(projectSlug: string, permission: string): boolean {
  const { user } = useSession();
  if (!user) return false;
  const perms = user.permissions_by_project[projectSlug];
  if (!perms) return false;
  return perms.includes(permission);
}
