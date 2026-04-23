/**
 * PlanDetailPage — STUB (SP3.4 Task 37)
 *
 * Placeholder until Task 43 (PlanDetailPage full impl) replaces this file.
 * The route `/p/:slug/plans/:wid` renders here.
 */
import { ClipboardList } from "lucide-react";
import { useParams } from "react-router-dom";

export function PlanDetailPage() {
  const { wid } = useParams<{ wid: string }>();

  return (
    <div
      className="flex flex-col items-center justify-center min-h-[60vh] gap-4"
      style={{ color: "var(--fg-muted)" }}
    >
      <ClipboardList
        className="h-12 w-12 opacity-30"
        aria-hidden="true"
        style={{ color: "var(--accent-primary)" }}
      />
      <div className="text-center">
        <h1
          className="text-lg font-semibold mb-1"
          style={{ color: "var(--fg-default)" }}
        >
          Plan Detail
        </h1>
        <p className="text-sm">
          Plan <code style={{ fontFamily: "monospace" }}>{wid}</code> — coming soon in SP3.4.
        </p>
      </div>
    </div>
  );
}
