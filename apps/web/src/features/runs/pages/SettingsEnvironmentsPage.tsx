import { Globe } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";

/**
 * SettingsEnvironmentsPage — admin CRUD for test environments.
 *
 * Rendered inside SettingsShell (left nav + content area).
 *
 * SP3.3 stub. Full implementation in Task 53.
 */
export function SettingsEnvironmentsPage() {
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Environments"
        subtitle="Manage named environments for test runs (e.g. Staging, Production)"
      />

      <div className="flex flex-1 items-center justify-center p-8">
        <UnderConstruction
          title="Environments CRUD coming in Task 53"
          description="Create, rename, and delete named environments. Admins only. Delete confirmation guards against runs referencing the environment."
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
      <Globe
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
