import { useQuery, useQueries } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { keys } from "@/lib/query/keys";
import type { Step, SharedStepRef } from "@/components/shared/StepTable";

export interface TestcaseDetail {
  id: string;
  wombat_id: string;
  title: string;
  kind: string;
  component?: string;
  priority?: "high" | "med" | "low";
  tags?: string[];
  automation?: "automated" | "manual";
  body?: string;
  steps?: Step[];
  source?: {
    revision?: string;
    last_synced?: string;
    owner?: string;
    history?: Array<{ revision: string; message?: string; author?: string; date?: string }>;
  };
  created_at?: string;
  updated_at?: string;
}

/** Extract shared-step wombat_ids referenced in body text like [[SS-NAV-001]] or steps */
function extractSharedStepIds(tc: TestcaseDetail): string[] {
  const ids = new Set<string>();

  // From steps array
  if (tc.steps) {
    for (const step of tc.steps) {
      if (step.shared_step_id) ids.add(step.shared_step_id);
    }
  }

  // From body markdown references [[SS-...]]
  if (tc.body) {
    const matches = tc.body.matchAll(/\[\[([A-Z]+-[A-Z0-9-]+)\]\]/g);
    for (const m of matches) {
      const captured = m[1];
      if (captured && captured.startsWith("SS-")) ids.add(captured);
    }
  }

  return Array.from(ids);
}

export function useTestcaseDetail(slug: string, wombatId: string) {
  const tcQuery = useQuery({
    queryKey: keys.testcase.detail(slug, wombatId),
    queryFn: async (): Promise<TestcaseDetail> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/testcases/{wombat_id}",
        { params: { path: { project_slug: slug, wombat_id: wombatId } } },
      );
      if (error) throw error;
      return data as TestcaseDetail;
    },
    enabled: Boolean(slug && wombatId),
  });

  const sharedStepIds = tcQuery.data ? extractSharedStepIds(tcQuery.data) : [];

  const sharedStepQueries = useQueries({
    queries: sharedStepIds.map((ssId) => ({
      queryKey: keys.sharedStep.detail(slug, ssId),
      queryFn: async () => {
        const { data, error } = await api.GET(
          "/api/projects/{project_slug}/shared-steps/{wombat_id}",
          { params: { path: { project_slug: slug, wombat_id: ssId } } },
        );
        if (error) throw error;
        return data as {
          wombat_id: string;
          title: string;
          body?: string;
          steps?: Step[];
        };
      },
      enabled: Boolean(slug && ssId),
      staleTime: 60_000,
    })),
  });

  /** Resolve a shared-step ID to a SharedStepRef for StepTable */
  function resolveSharedStep(id: string): SharedStepRef | null | undefined {
    const idx = sharedStepIds.indexOf(id);
    if (idx < 0) return null;
    const q = sharedStepQueries[idx];
    if (!q) return null;
    if (q.isLoading) return undefined;
    if (!q.data) return null;
    return {
      id: q.data.wombat_id,
      title: q.data.title,
      snippet: q.data.body?.slice(0, 120),
      steps: q.data.steps ?? [],
    };
  }

  return {
    testcase: tcQuery.data,
    isLoading: tcQuery.isLoading,
    isError: tcQuery.isError,
    error: tcQuery.error,
    refetch: tcQuery.refetch,
    resolveSharedStep,
    sharedStepsLoading: sharedStepQueries.some((q) => q.isLoading),
  };
}
