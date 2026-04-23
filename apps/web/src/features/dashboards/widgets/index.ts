/**
 * Frontend widget registry (SP3.4 Task 49).
 *
 * Adding a 6th widget = one Component export + one entry here.
 * No bespoke routing, no per-widget Context providers.
 *
 * Each component accepts `{scope, filters}` props and owns its own
 * `useWidget` call (keyed on the component's widget slug).
 */

export { PassFailTrend } from "./PassFailTrend";
export { RecentRuns } from "./RecentRuns";
export { TopFailingCases } from "./TopFailingCases";
export { ReviewBacklog } from "./ReviewBacklog";
export { ReleaseReadiness } from "./ReleaseReadiness";

import type { ComponentType } from "react";
import type { Scope, Filters } from "../hooks";

export interface WidgetComponentProps {
  scope: Scope;
  filters?: Filters;
}

export interface WidgetRegistryEntry {
  title: string;
  Component: ComponentType<WidgetComponentProps>;
}

import { PassFailTrend } from "./PassFailTrend";
import { RecentRuns } from "./RecentRuns";
import { TopFailingCases } from "./TopFailingCases";
import { ReviewBacklog } from "./ReviewBacklog";
import { ReleaseReadiness } from "./ReleaseReadiness";

export const WIDGETS = {
  passfail_trend: {
    title: "Pass / fail trend",
    Component: PassFailTrend,
  },
  recent_runs: {
    title: "Recent runs",
    Component: RecentRuns,
  },
  top_failing_cases: {
    title: "Top failing cases",
    Component: TopFailingCases,
  },
  review_backlog: {
    title: "Review backlog",
    Component: ReviewBacklog,
  },
  release_readiness: {
    title: "Release readiness",
    Component: ReleaseReadiness,
  },
} as const satisfies Record<string, WidgetRegistryEntry>;

export type WidgetSlug = keyof typeof WIDGETS;
