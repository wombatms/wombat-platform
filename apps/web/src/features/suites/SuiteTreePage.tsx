/**
 * SuiteTreePage — STUB (SP3.4 Task 37)
 *
 * Placeholder until Task 45 (SuiteTree + SuiteTreePage full impl) replaces this.
 * The route `/p/:slug/suites` renders here.
 */
import { FolderTree } from "lucide-react";
import { useParams } from "react-router-dom";

export function SuiteTreePage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[60vh] gap-4"
      style={{ color: "var(--fg-muted)" }}
    >
      <FolderTree
        className="h-12 w-12 opacity-30"
        aria-hidden="true"
        style={{ color: "var(--accent-primary)" }}
      />
      <div className="text-center">
        <h1
          className="text-lg font-semibold mb-1"
          style={{ color: "var(--fg-default)" }}
        >
          Suites
        </h1>
        <p className="text-sm">
          Suite tree for{" "}
          <span style={{ color: "var(--fg-default)" }}>{projectSlug}</span> — coming
          soon in SP3.4.
        </p>
      </div>
    </div>
  );
}
