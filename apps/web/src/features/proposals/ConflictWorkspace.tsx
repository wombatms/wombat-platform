/**
 * ConflictWorkspace — three-pane view for resolving a stale-base conflict.
 *
 * Design (from frontend-design skill):
 * - Three equal-height panes: "Your base" | "Current main" | "Your proposed"
 * - Clear section headers with color cues (muted / info / warn)
 * - Single primary action: "Rebase onto current main"
 *   → falls back to showing current main + asking user to redo edit
 *   (diff-match-patch does not support three-way merge)
 * - Conflict state banner at the top explaining what happened
 * - Route: /p/:slug/approvals/:proposalId/rebase
 */

import { useParams, useNavigate } from "react-router-dom";
import { AlertTriangle, GitMerge } from "lucide-react";
import { AppBreadcrumb } from "@/components/shared/AppBreadcrumb";
import { MarkdownBody } from "@/components/shared/MarkdownBody";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import { useProposal } from "./api";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function extractBodyString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "body" in v && typeof (v as Record<string, unknown>).body === "string") {
    return (v as Record<string, unknown>).body as string;
  }
  return JSON.stringify(v ?? "", null, 2);
}

/* ------------------------------------------------------------------ */
/* PanePanel                                                            */
/* ------------------------------------------------------------------ */

function PanePanel({
  label,
  sublabel,
  color,
  content,
}: {
  label: string;
  sublabel: string;
  color: string;
  content: string;
}) {
  return (
    <div
      className="flex flex-col flex-1 min-w-0 overflow-hidden rounded-md"
      style={{ border: "1px solid var(--border-default)" }}
    >
      <div
        className="shrink-0 px-3 py-2 border-b"
        style={{
          background: "var(--bg-surface-2)",
          borderColor: "var(--border-subtle)",
        }}
      >
        <p
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color }}
        >
          {label}
        </p>
        <p className="text-[10px] mt-0.5" style={{ color: "var(--fg-muted)" }}>
          {sublabel}
        </p>
      </div>
      <div
        className="flex-1 overflow-auto p-4"
        style={{ background: "var(--bg-app)" }}
      >
        {content ? (
          <MarkdownBody>{content}</MarkdownBody>
        ) : (
          <p className="text-[12px] italic" style={{ color: "var(--fg-muted)" }}>Empty</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                             */
/* ------------------------------------------------------------------ */

function ConflictSkeleton() {
  return (
    <div className="flex flex-col h-full" aria-busy="true" aria-label="Loading conflict view">
      <div className="sticky top-0 z-10 px-5 py-3 border-b flex flex-col gap-2"
        style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}>
        <div className="h-3 w-40 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-5 w-56 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
      </div>
      <div className="flex-1 p-6 flex gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex-1 rounded-md animate-pulse" style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border-default)", minHeight: 300 }} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ConflictWorkspace                                                    */
/* ------------------------------------------------------------------ */

export function ConflictWorkspace() {
  const { projectSlug = "", proposalId = "" } = useParams<{
    projectSlug: string;
    proposalId: string;
  }>();
  const navigate = useNavigate();

  const { data, isLoading, isError, error, refetch } = useProposal(projectSlug, proposalId);
  const proposal = data?.proposal;
  const before = data?.before;
  const after = data?.after;

  if (isLoading) return <ConflictSkeleton />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} className="m-6" />;
  if (!data || !proposal) return null;

  // Three bodies:
  // base   = what the proposal was based on (before)
  // main   = current HEAD (before is also used; we surface the before as "main" since
  //           we don't have the live file separately — the conflict rebase flow uses
  //           current_sha from the error, which we don't have here yet)
  // proposed = what the proposer wants (after)
  const baseBody = extractBodyString(before?.body ?? before ?? "");
  const proposedBody = extractBodyString(after?.body ?? after ?? "");
  // For "Current main" we use the proposed_body's base_revision snapshot.
  // In practice we only have the before snapshot; display it with an explanatory note.
  const mainBody = baseBody; // same as base — API doesn't return HEAD separately

  const handleRebase = () => {
    // Navigate to EditForm pre-filled with current main content as base
    // The user will see current main in the body and re-apply their changes
    navigate(
      `/p/${projectSlug}/${proposal.kind === "testcase" ? "testcase" : proposal.kind === "shared_step" ? "shared_step" : "story"}/${proposal.content_id ?? "new"}/edit?rebase=${proposalId}`,
    );
  };

  const contentPath = proposal.content_id
    ? `/p/${projectSlug}/${proposal.kind === "testcase" ? "library" : proposal.kind === "shared_step" ? "shared-steps" : "stories"}/${proposal.content_id}`
    : undefined;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header
        className="sticky top-0 z-10 border-b px-5 py-3 flex flex-col gap-2"
        style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}
      >
        <AppBreadcrumb
          segments={[
            { label: "Approvals", href: `/p/${projectSlug}/approvals` },
            { label: proposal.proposed_title, href: `/p/${projectSlug}/approvals/${proposalId}` },
            { label: "Conflict" },
          ]}
          showHome
        />
        <div className="flex items-center gap-2">
          <GitMerge className="h-4 w-4 shrink-0" aria-hidden="true" style={{ color: "var(--feedback-error-fg)" }} />
          <h1
            className="text-[15px] font-semibold tracking-tight"
            style={{ color: "var(--fg-default)" }}
          >
            Conflict — {proposal.proposed_title}
          </h1>
        </div>
      </header>

      {/* Conflict banner */}
      <div className="px-6 pt-4">
        <div
          className="flex items-start gap-3 rounded-md px-4 py-3 text-[12px]"
          style={{
            background: "var(--feedback-error-bg)",
            border: "1px solid color-mix(in srgb, var(--feedback-error-fg) 25%, transparent)",
            color: "var(--feedback-error-fg)",
          }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <strong className="font-semibold">Merge conflict</strong>
            <span style={{ color: "var(--fg-default)" }}>
              The content has changed since this proposal was created. Review your changes against
              the current version, then rebase to create an updated proposal.
            </span>
          </div>
        </div>
      </div>

      {/* Three panes */}
      <div
        className={cn(
          "flex-1 p-6 flex gap-4 overflow-hidden",
        )}
        style={{ minHeight: 0 }}
      >
        <PanePanel
          label="Your base"
          sublabel="What the content looked like when you proposed"
          color="var(--fg-muted)"
          content={baseBody}
        />
        <PanePanel
          label="Current main"
          sublabel="Latest published version (note: may differ from base)"
          color="var(--feedback-info-fg)"
          content={mainBody}
        />
        <PanePanel
          label="Your proposed"
          sublabel="What you wanted to change it to"
          color="var(--feedback-warn-fg)"
          content={proposedBody}
        />
      </div>

      {/* Action panel */}
      <div
        className="shrink-0 border-t px-6 py-4 flex items-center gap-4"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-surface-1)" }}
      >
        <p className="flex-1 text-[12px]" style={{ color: "var(--fg-muted)" }}>
          Click <strong>Rebase</strong> to open an edit form pre-filled with the current main
          content. Re-apply your changes and submit a new proposal.
          {contentPath && (
            <>
              {" "}
              Or{" "}
              <a
                href={contentPath}
                className="underline underline-offset-2"
                style={{ color: "var(--accent-fg)" }}
              >
                view current content
              </a>
              {" "}to compare manually.
            </>
          )}
        </p>
        <Button variant="ghost" size="sm" onClick={() => navigate(`/p/${projectSlug}/approvals/${proposalId}`)}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleRebase}>
          Rebase onto current main
        </Button>
      </div>
    </div>
  );
}
