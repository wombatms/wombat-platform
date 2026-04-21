import { Link } from "react-router-dom";
import { Home } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export interface BreadcrumbSegment {
  /** Human-readable label */
  label: string;
  /** If present, segment is a link; otherwise it is the current page */
  href?: string;
}

interface AppBreadcrumbProps {
  segments: BreadcrumbSegment[];
  /** Show a home icon as the first segment linking to /projects */
  showHome?: boolean;
}

/**
 * AppBreadcrumb — wraps shadcn Breadcrumb with React Router Link integration.
 *
 * Usage:
 *   <AppBreadcrumb
 *     showHome
 *     segments={[
 *       { label: "Test Library", href: `/p/${slug}/library` },
 *       { label: "TC-PAY-0012" },
 *     ]}
 *   />
 *
 * The last segment without an href is rendered as `BreadcrumbPage` (aria-current=page).
 */
export function AppBreadcrumb({ segments, showHome = false }: AppBreadcrumbProps) {
  const items: BreadcrumbSegment[] = showHome
    ? [{ label: "Home", href: "/projects" }, ...segments]
    : segments;

  return (
    <Breadcrumb>
      <BreadcrumbList className="text-xs">
        {items.map((seg, idx) => {
          const isLast = idx === items.length - 1;
          const isHome = showHome && idx === 0;

          return (
            <span key={idx} className="inline-flex items-center gap-1.5">
              {idx > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {seg.href && !isLast ? (
                  <BreadcrumbLink asChild>
                    <Link
                      to={seg.href}
                      className="inline-flex items-center gap-1"
                    >
                      {isHome ? (
                        <>
                          <Home
                            className="h-3 w-3 shrink-0"
                            aria-hidden="true"
                          />
                          <span className="sr-only">{seg.label}</span>
                        </>
                      ) : (
                        seg.label
                      )}
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="text-xs">
                    {isHome ? (
                      <>
                        <Home className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span className="sr-only">{seg.label}</span>
                      </>
                    ) : (
                      seg.label
                    )}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </span>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
