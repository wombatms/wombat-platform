import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { keys } from "@/lib/query/keys";

export interface StoryDetail {
  id: string;
  wombat_id: string;
  title: string;
  kind: string;
  tags?: string[];
  body?: string;
  source?: {
    revision?: string;
    history?: Array<{ revision: string; message?: string; author?: string; date?: string }>;
  };
  created_at?: string;
  updated_at?: string;
}

export function useStoryDetail(slug: string, wombatId: string) {
  return useQuery({
    queryKey: keys.story.detail(slug, wombatId),
    queryFn: async (): Promise<StoryDetail> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/stories/{wombat_id}",
        { params: { path: { project_slug: slug, wombat_id: wombatId } } },
      );
      if (error) throw error;
      return data as StoryDetail;
    },
    enabled: Boolean(slug && wombatId),
  });
}
