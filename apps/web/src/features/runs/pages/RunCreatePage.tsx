import { ListChecks } from "lucide-react";
import { useParams } from "react-router-dom";
import { PageHeader } from "@/components/shared/PageHeader";

/**
 * RunCreatePage — two-column create-run form with 3-tab case selector.
 *
 * SP3.3 stub. Full implementation in Task 44.
 */
export function RunCreatePage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  void projectSlug;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="New Run"
        subtitle="Configure and launch a test execution run"
      />

      <div className="flex flex-1 items-center justify-center p-8">
        <UnderConstruction
          title="Run creation form coming in Task 44"
          description="Two-column layout: metadata form left, 3-tab case selector (Filter / Paste IDs / From Library) right."
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
      <ListChecks
        className="h-8 w-8"
        aria-hidden="true"
        style={{ color: "var(--fg-disabled)" }}
      />
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
