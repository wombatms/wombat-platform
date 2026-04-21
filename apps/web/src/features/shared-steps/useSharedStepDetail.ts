import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { keys } from "@/lib/query/keys";
import type { Step } from "@/components/shared/StepTable";

export interface SharedStepDetail {
  id: string;
  wombat_id: string;
  title: string;
  kind: string;
  tags?: string[];
  body?: string;
  steps?: Step[];
  source?: {
    revision?: string;
    history?: Array<{ revision: string; message?: string; author?: string; date?: string }>;
  };
  created_at?: string;
  updated_at?: string;
}

export function useSharedStepDetail(slug: string, wombatId: string) {
  return useQuery({
    queryKey: keys.sharedStep.detail(slug, wombatId),
    queryFn: async (): Promise<SharedStepDetail> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/shared-steps/{wombat_id}",
        { params: { path: { project_slug: slug, wombat_id: wombatId } } },
      );
      if (error) throw error;
      return data as SharedStepDetail;
    },
    enabled: Boolean(slug && wombatId),
  });
}
