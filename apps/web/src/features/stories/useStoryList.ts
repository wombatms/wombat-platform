import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { keys } from "@/lib/query/keys";

export interface Story {
  id: string;
  wombat_id: string;
  title: string;
  kind: string;
  tags?: string[];
  body?: string;
  created_at?: string;
  updated_at?: string;
}

export interface StoryListResponse {
  data: Story[];
  total: number;
  limit: number;
  offset: number;
}

export interface StoryListFilters {
  q?: string;
  tag?: string[];
  limit?: number;
  offset?: number;
}

export function useStoryList(slug: string, filters: StoryListFilters = {}) {
  const { q, tag, limit = 100, offset = 0 } = filters;

  return useQuery({
    queryKey: keys.story.list(slug, { q, tag, limit, offset }),
    queryFn: async (): Promise<StoryListResponse> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/stories",
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
      return data as StoryListResponse;
    },
    enabled: Boolean(slug),
    staleTime: 30_000,
  });
}
