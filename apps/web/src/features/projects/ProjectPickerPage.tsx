import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "./useProjects";

function RoleBadge({ role }: { role?: string }) {
  if (!role) return null;
  return (
    <Badge
      variant="outline"
      className="ml-auto text-xs"
    >
      {role}
    </Badge>
  );
}

export function ProjectPickerPage() {
  const { data: projects, isLoading, error } = useProjects();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-xl px-6 py-12 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-6 py-12">
        <p className="text-sm" style={{ color: "var(--feedback-error-fg)" }}>
          Failed to load projects. Please try refreshing.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-2 text-xl font-semibold" style={{ color: "var(--fg-default)" }}>
        Choose a project
      </h1>
      <p className="mb-8 text-sm" style={{ color: "var(--fg-muted)" }}>
        Select a project to begin browsing test cases, shared steps, and stories.
      </p>

      {!projects || projects.length === 0 ? (
        <div
          className="rounded-lg border px-6 py-10 text-center"
          style={{
            background: "var(--bg-surface-1)",
            borderColor: "var(--border-default)",
          }}
        >
          <p className="text-sm font-medium" style={{ color: "var(--fg-default)" }}>
            No projects yet
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--fg-muted)" }}>
            Create one via the API or CLI to get started.
          </p>
        </div>
      ) : (
        <ul className="space-y-3" role="list">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                onClick={() => navigate(`/p/${project.slug}/library`)}
                className="w-full rounded-lg border px-5 py-4 text-left transition-colors hover:border-[color:var(--accent-primary)] hover:bg-[color:var(--accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--focus-ring)] focus-visible:outline-offset-2"
                style={{
                  background: "var(--bg-surface-1)",
                  borderColor: "var(--border-default)",
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="truncate text-sm font-semibold"
                        style={{ color: "var(--fg-default)" }}
                      >
                        {project.name}
                      </span>
                      <RoleBadge role={project.role} />
                    </div>
                    <code
                      className="mt-0.5 block text-xs"
                      style={{ color: "var(--fg-muted)" }}
                    >
                      {project.slug}
                    </code>
                    {(project.org ?? project.default_owner) && (
                      <p className="mt-1 text-xs" style={{ color: "var(--fg-muted)" }}>
                        {[project.org, project.default_owner].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
