import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "@/lib/query/keys";
import { useProjects, type Project } from "./useProjects";

const LAST_PROJECT_KEY = "wombat.last_project_slug";

export function useActiveProject(): {
  projectSlug: string | null;
  project: Project | null;
  isLoading: boolean;
} {
  const params = useParams<{ projectSlug?: string }>();
  const { data: projects, isLoading } = useProjects();
  const queryClient = useQueryClient();

  // Resolution order: URL param → last_project_slug → first project
  const urlSlug = params.projectSlug ?? null;
  const lastSlug = localStorage.getItem(LAST_PROJECT_KEY);

  let projectSlug: string | null = null;
  if (urlSlug) {
    projectSlug = urlSlug;
  } else if (lastSlug) {
    projectSlug = lastSlug;
  } else if (projects && projects.length > 0) {
    projectSlug = projects[0]?.slug ?? null;
  }

  const project = projects?.find((p) => p.slug === projectSlug) ?? null;

  // Persist the resolved slug whenever it changes
  useEffect(() => {
    if (projectSlug) {
      const prev = localStorage.getItem(LAST_PROJECT_KEY);
      if (prev !== projectSlug) {
        localStorage.setItem(LAST_PROJECT_KEY, projectSlug);
      }
    }
  }, [projectSlug]);

  // When switching projects (URL slug changes), remove queries for the old project
  useEffect(() => {
    if (urlSlug && lastSlug && urlSlug !== lastSlug) {
      queryClient.removeQueries({ queryKey: keys.project(lastSlug) });
    }
  }, [urlSlug, lastSlug, queryClient]);

  return { projectSlug, project, isLoading };
}
