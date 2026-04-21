import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { keys } from "@/lib/query/keys";
import type { Step } from "@/components/shared/StepTable";

export interface SharedStep {
  id: string;
  wombat_id: string;
  title: string;
  kind: string;
  tags?: string[];
  body?: string;
  steps?: Step[];
  created_at?: string;
  updated_at?: string;
}

export interface SharedStepListResponse {
  data: SharedStep[];
  total: number;
  limit: number;
  offset: number;
}

export interface SharedStepListFilters {
  q?: string;
  tag?: string[];
  limit?: number;
  offset?: number;
}

export function useSharedStepList(
  slug: string,
  filters: SharedStepListFilters = {},
) {
  const { q, tag, limit = 100, offset = 0 } = filters;

  return useQuery({
    queryKey: keys.sharedStep.list(slug, { q, tag, limit, offset }),
    queryFn: async (): Promise<SharedStepListResponse> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/shared-steps",
        {
          params: {
            path: { project_slug: slug },
            query: {
              ...(q ? { q } : {}),
              ...(tag && tag.length > 0 ? { tag } : {}),
              limit,
              offset,
            },
          },
        },
      );
      if (error) throw error;
      return data as SharedStepListResponse;
    },
    enabled: Boolean(slug),
    staleTime: 30_000,
  });
}
