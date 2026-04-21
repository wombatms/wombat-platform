import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { keys } from "@/lib/query/keys";

// The /api/projects/ response shape is not typed in the schema (schema: {})
// so we define it here based on SP2's ProjectCreate + role fields.
export interface Project {
  id: string;
  slug: string;
  name: string;
  org: string | null;
  default_owner: string | null;
  taxonomy_components: string[];
  taxonomy_environments: string[];
  // role on this project for the current user
  role?: string;
}

export function useProjects() {
  return useQuery({
    queryKey: keys.projects.list,
    queryFn: async () => {
      const { data, error } = await api.GET("/api/projects/");
      if (error) throw error;
      // API returns array directly or wrapped in { data: [...] }
      if (Array.isArray(data)) return data as Project[];
      const d = data as { data?: Project[] } | null;
      return d?.data ?? [];
    },
  });
}
