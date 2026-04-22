/**
 * Environment query + mutation hooks.
 *
 * Environments are project-scoped (not run-scoped). Query keys live under the
 * `["environments", projectSlug]` namespace defined in queryKeys.ts so that
 * invalidating environments never disturbs run-detail cache entries.
 *
 * All mutations throw ApiError subclasses via mapRunError — never raw Response.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { runKeys } from "../queryKeys";
import { mapRunError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface Environment {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
}

export interface EnvironmentListResponse {
  data: Environment[];
}

export interface EnvironmentCreateBody {
  name: string;
}

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

/**
 * List all environments for a project.
 * Any project member may call this (viewer/editor/admin).
 */
export function useEnvironments(projectSlug: string) {
  return useQuery({
    queryKey: runKeys.environments(projectSlug),
    queryFn: async (): Promise<Environment[]> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/environments",
        {
          params: { path: { project_slug: projectSlug } },
        },
      );
      if (error) throw error;
      const response = data as EnvironmentListResponse;
      return response.data;
    },
    enabled: Boolean(projectSlug),
    refetchOnWindowFocus: true,
  });
}

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

/**
 * Create a new environment in the project.
 * Duplicate names return 409 which maps to an ApiError with code
 * `environment_already_exists` (or similar — surfaced via mapRunError).
 * On success: invalidates the environments list for the project.
 */
export function useCreateEnvironment(projectSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: EnvironmentCreateBody): Promise<Environment> => {
      try {
        const { data, error } = await api.POST(
          "/api/projects/{project_slug}/environments",
          {
            params: { path: { project_slug: projectSlug } },
            body: body as Parameters<typeof api.POST>[1]["body"],
          },
        );
        if (error) throw error;
        return (data as { data: Environment }).data;
      } catch (err) {
        mapRunError(err);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: runKeys.environments(projectSlug) });
    },
  });
}

/**
 * Hard-delete an environment from the project.
 * Requires admin role. Existing runs that referenced this environment retain
 * their environment_id but the FK now points to a deleted record — that is
 * intentional per the API spec (no cascade wipe of historical run data).
 * On success: invalidates the environments list for the project.
 */
export function useDeleteEnvironment(projectSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (envId: string): Promise<void> => {
      try {
        const { error } = await api.DELETE(
          "/api/projects/{project_slug}/environments/{env_id}",
          {
            params: { path: { project_slug: projectSlug, env_id: envId } },
          },
        );
        if (error) throw error;
      } catch (err) {
        mapRunError(err);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: runKeys.environments(projectSlug) });
    },
  });
}
