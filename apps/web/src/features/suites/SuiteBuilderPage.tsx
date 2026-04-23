/**
 * SuiteBuilderPage — STUB (SP3.4 Task 37)
 *
 * Placeholder until Task 38–41 (ContentBuilder) replaces this file.
 * Routes:
 *   `/p/:slug/suites/new`        → mode="create"  (honors ?parent=<wid>)
 *   `/p/:slug/suites/:wid/edit`  → mode="edit"
 */
import { FolderTree } from "lucide-react";
import { useParams, useSearchParams } from "react-router-dom";

interface SuiteBuilderPageProps {
  mode: "create" | "edit";
}

export function SuiteBuilderPage({ mode }: SuiteBuilderPageProps) {
  const { wid } = useParams<{ wid?: string }>();
  const [searchParams] = useSearchParams();
  const parentWid = searchParams.get("parent");

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
          {mode === "create" ? "New Suite" : "Edit Suite"}
        </h1>
        <p className="text-sm">
          {mode === "edit" && wid ? (
            <>
              Editing suite <code style={{ fontFamily: "monospace" }}>{wid}</code> —
            </>
          ) : parentWid ? (
            <>
              Creating sub-suite under{" "}
              <code style={{ fontFamily: "monospace" }}>{parentWid}</code> —
            </>
          ) : (
            "Suite builder"
          )}{" "}
          coming soon in SP3.4.
        </p>
      </div>
    </div>
  );
}
