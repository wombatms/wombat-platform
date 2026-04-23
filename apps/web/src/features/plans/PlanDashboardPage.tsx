/**
 * PlanDashboardPage — plan-home dashboard route (SP3.4 Task 52).
 *
 * Route: /p/:projectSlug/plans/:wid/dashboard
 *
 * Design decisions (frontend-design skill):
 * - Breadcrumb: AppBreadcrumb with two segments — "Plan" (linked back to
 *   /p/:slug/plans/:wid) + "Dashboard" (current page, no href). No showHome —
 *   the plan context provides sufficient orientation.
 * - Header: PageHeader with title "Dashboard". Breadcrumb renders above the
 *   sticky header strip in a narrow sub-bar so it doesn't compete visually
 *   with the page title. Both zones share the same sticky top-0 context so
 *   they scroll off together.
 * - scopeId = wid (plan wombat_id). The backend widget endpoint accepts
 *   scope=plan&scope_id=<wombat_id> and resolves the plan internally.
 * - No empty-state detection at this level. Widget frames own their empty
 *   states; PlanDashboardPage just wires scope and navigation.
 * - review_backlog is omitted by DashboardPage's `scope === "project"` guard —
 *   no widget-level check needed here.
 */

import { useParams } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppBreadcrumb } from "@/components/shared/AppBreadcrumb";
import { DashboardPage } from "@/features/dashboards/DashboardPage";

export function PlanDashboardPage() {
  const { projectSlug = "", wid = "" } = useParams<{
    projectSlug: string;
    wid: string;
  }>();

  const planDetailHref = `/p/${projectSlug}/plans/${wid}`;

  return (
    <div className="flex flex-col h-full" style={{ overflowY: "auto" }}>
      {/*
        Sticky zone: breadcrumb sub-bar + page header.
        Both are sticky at top-0 so they depart together on scroll.
        z-10 matches PageHeader's own z-index.
      */}
      <div
        className="sticky top-0 z-10 flex flex-col"
        style={{ background: "var(--bg-app)" }}
      >
        {/* Breadcrumb sub-bar */}
        <div
          className="flex items-center px-5 py-1.5"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <AppBreadcrumb
            segments={[
              { label: "Plan", href: planDetailHref },
              { label: "Dashboard" },
            ]}
          />
        </div>

        {/* Page title strip */}
        <PageHeader title="Dashboard" />
      </div>

      {/* Content area */}
      <main className="flex-1 px-5 py-5">
        <DashboardPage scope="plan" scopeId={wid} />
      </main>
    </div>
  );
}
