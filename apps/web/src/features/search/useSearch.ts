import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { keys } from "@/lib/query/keys";
import type { components } from "@/lib/api/schema";

export type SearchMode = "hybrid" | "semantic" | "keyword";

export interface SearchHit {
  id: string;
  wombat_id: string;
  title: string;
  kind: string;
  tags?: string[];
  score: number;
  highlight?: string;
  component?: string;
  priority?: string;
  automation?: string;
}

export interface SearchResponse {
  query: string;
  mode: SearchMode;
  hits: SearchHit[];
}

export interface UseSearchParams {
  slug: string;
  query: string;
  mode?: SearchMode;
  kinds?: string[];
  tags?: string[];
  top_k?: number;
  include_chunks?: boolean;
}

export function useSearch({
  slug,
  query,
  mode = "hybrid",
  kinds,
  tags,
  top_k = 30,
  include_chunks = true,
}: UseSearchParams) {
  const requestBody: components["schemas"]["SearchRequest"] = {
    query,
    mode,
    kinds: kinds && kinds.length > 0 ? kinds : null,
    tags: tags && tags.length > 0 ? tags : null,
    top_k,
    include_chunks,
  };

  const bodyKey = requestBody as Record<string, unknown>;

  return useQuery({
    queryKey: keys.search(slug, bodyKey),
    queryFn: async (): Promise<SearchResponse> => {
      const { data, error } = await api.POST(
        "/api/projects/{project_slug}/search",
        {
          params: { path: { project_slug: slug } },
          body: requestBody,
        },
      );
      if (error) throw error;
      return data as unknown as SearchResponse;
    },
    enabled: Boolean(slug && query.length >= 2),
    staleTime: 30_000,
  });
}
