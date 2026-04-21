import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "./useSession";
import { Skeleton } from "@/components/ui/skeleton";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const loc = useLocation();

  if (status === "loading") return <Skeleton className="h-16 w-full" />;

  if (status === "anonymous") {
    return (
      <Navigate
        to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`}
        replace
      />
    );
  }

  return <>{children}</>;
}
