import { PlayCircle } from "lucide-react";
import { useParams, Link } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";

/**
 * RunsPage — list of test runs for a project.
 *
 * SP3.3 stub. Full implementation in Task 43.
 */
export function RunsPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Runs"
        subtitle="Test execution runs for this project"
        actions={
          <Link
            to={`/p/${projectSlug}/runs/new`}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              background: "var(--accent-primary)",
              color: "var(--fg-inverse)",
            }}
          >
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
            New run
          </Link>
        }
      />

      <div className="flex flex-1 items-center justify-center p-8">
        <UnderConstruction
          title="Runs list coming in Task 43"
          description="Virtualized run list with status chips, progress bars, and facet filtering."
        />
      </div>
    </div>
  );
}

function UnderConstruction({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-xl px-10 py-10 text-center max-w-sm"
      style={{
        background: "var(--bg-surface-1)",
        border: "1px dashed var(--border-strong)",
      }}
    >
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide uppercase"
        style={{
          background: "var(--feedback-warn-bg)",
          color: "var(--feedback-warn-fg)",
        }}
      >
        Under construction
      </span>
      <p
        className="text-sm font-semibold"
        style={{ color: "var(--fg-default)" }}
      >
        {title}
      </p>
      {description && (
        <p className="text-xs leading-relaxed" style={{ color: "var(--fg-muted)" }}>
          {description}
        </p>
      )}
    </div>
  );
}
