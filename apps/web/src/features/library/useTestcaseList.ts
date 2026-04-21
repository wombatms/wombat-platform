import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { keys } from "@/lib/query/keys";

export interface TestcaseListFilters {
  q?: string;
  component?: string;
  tag?: string[];
  limit?: number;
  offset?: number;
}

export interface Testcase {
  id: string;
  wombat_id: string;
  title: string;
  kind: string;
  component?: string;
  priority?: "high" | "med" | "low";
  tags?: string[];
  automation?: "automated" | "manual";
  body?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TestcaseListResponse {
  data: Testcase[];
  total: number;
  limit: number;
  offset: number;
}

export function useTestcaseList(
  slug: string,
  filters: TestcaseListFilters = {},
) {
  const { q, component, tag, limit = 100, offset = 0 } = filters;

  return useQuery({
    queryKey: keys.testcase.list(slug, { q, component, tag, limit, offset }),
    queryFn: async (): Promise<TestcaseListResponse> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/testcases",
        {
          params: {
            path: { project_slug: slug },
            query: {
              ...(q ? { q } : {}),
              ...(component ? { component } : {}),
              ...(tag && tag.length > 0 ? { tag } : {}),
              limit,
              offset,
            },
          },
        },
      );
      if (error) throw error;
      return data as TestcaseListResponse;
    },
    enabled: Boolean(slug),
    staleTime: 30_000,
  });
}
