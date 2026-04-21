/**
 * ReviewDetailPage — full review view for a single proposal.
 *
 * Design (from frontend-design skill):
 * - Breadcrumb → title/status header
 * - FrontmatterDiffTable above MarkdownDiffSplit
 * - Rendered | Raw toggle (button group)
 * - Docked action panel at the bottom: comment textarea + Reject + Approve buttons
 * - Approve/Reject hidden when user is the author (self-approval blocked)
 * - Events timeline (collapsed by default)
 * - On 409 stale_base_revision → navigate to conflict workspace
 * - All colors via SP3.1 tokens
 */

import { useState, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { AppBreadcrumb } from "@/components/shared/AppBreadcrumb";
import { FrontmatterDiffTable } from "@/components/shared/FrontmatterDiffTable";
import { MarkdownDiffSplit } from "@/components/shared/MarkdownDiffSplit";
import { ErrorState } from "@/components/shared/ErrorState";
import { Button } from "@/components/ui/button";
import {
  useProposal,
  useApproveProposal,
  useRejectProposal,
  type ProposalEventResponse,
} from "./api";
import { ConflictError } from "./errors";
import { usePermission } from "@/features/auth/useSession";
import { useSession } from "@/features/auth/useSession";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Skeleton                                                             */
/* ------------------------------------------------------------------ */

function ReviewSkeleton() {
  return (
    <div className="flex flex-col h-full" aria-busy="true" aria-label="Loading proposal">
      <div
        className="sticky top-0 z-10 px-5 py-3 border-b flex flex-col gap-2"
        style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}
      >
        <div className="h-3 w-40 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        <div className="h-5 w-64 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
      </div>
      <div className="flex-1 p-6 flex flex-col gap-5 max-w-4xl">
        <div className="h-32 rounded-md animate-pulse" style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border-default)" }} />
        <div className="h-64 rounded-md animate-pulse" style={{ background: "var(--bg-surface-2)", border: "1px solid var(--border-default)" }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Events timeline                                                      */
/* ------------------------------------------------------------------ */

const EVENT_ACTION_LABELS: Record<string, { label: string; color: string }> = {
  created: { label: "Proposed", color: "var(--feedback-info-fg)" },
  approved: { label: "Approved", color: "var(--feedback-success-fg)" },
  rejected: { label: "Rejected", color: "var(--feedback-error-fg)" },
  withdrawn: { label: "Withdrawn", color: "var(--fg-muted)" },
  rebased: { label: "Rebased", color: "var(--chart-cat-4)" },
};

function EventTimeline({ events }: { events: ProposalEventResponse[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded-sm"
        style={{ color: "var(--fg-muted)" }}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
        Event history ({events.length})
      </button>

      {open && (
        <ol className="mt-2 flex flex-col gap-2 pl-4 border-l" style={{ borderColor: "var(--border-default)" }}>
          {events.map((ev) => {
            const info = EVENT_ACTION_LABELS[ev.action] ?? {
              label: ev.action,
              color: "var(--fg-muted)",
            };
            return (
              <li key={ev.id} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[11px] font-semibold"
                    style={{ color: info.color }}
                  >
                    {info.label}
                  </span>
                  <span
                    className="text-[10px] tabular-nums"
                    style={{ color: "var(--fg-muted)" }}
                    title={ev.created_at}
                  >
                    {new Date(ev.created_at).toLocaleString()}
                  </span>
                </div>
                {ev.comment && (
                  <p
                    className="text-[12px] leading-relaxed"
                    style={{ color: "var(--fg-default)" }}
                  >
                    {ev.comment}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ReviewDetailPage                                                     */
/* ------------------------------------------------------------------ */

export function ReviewDetailPage() {
  const { projectSlug = "", proposalId = "" } = useParams<{
    projectSlug: string;
    proposalId: string;
  }>();
  const navigate = useNavigate();
  const { user } = useSession();
  const canApprove = usePermission(projectSlug, "content:publish_direct");

  const [diffMode, setDiffMode] = useState<"rendered" | "raw">("rendered");
  const [comment, setComment] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useProposal(projectSlug, proposalId);
  const { mutate: approve, isPending: approving } = useApproveProposal(projectSlug);
  const { mutate: reject, isPending: rejecting } = useRejectProposal(projectSlug);

  const proposal = data?.proposal;
  const before = data?.before;
  const after = data?.after;
  const events = data?.events ?? [];

  const isAuthor = user?.id === proposal?.author_user_id;
  const isActionable = canApprove && !isAuthor && proposal?.status === "open";

  const handleApprove = useCallback(() => {
    setActionError(null);
    approve(
      { proposalId, body: { comment: comment.trim() || undefined } },
      {
        onSuccess: () => navigate(`/p/${projectSlug}/approvals`),
        onError: (err) => {
          if (err instanceof ConflictError) {
            navigate(`/p/${projectSlug}/approvals/${proposalId}/rebase`);
          } else {
            setActionError(err instanceof Error ? err.message : "Action failed");
          }
        },
      },
    );
  }, [approve, proposalId, comment, navigate, projectSlug]);

  const handleReject = useCallback(() => {
    setActionError(null);
    reject(
      { proposalId, body: { comment: comment.trim() || undefined } },
      {
        onSuccess: () => navigate(`/p/${projectSlug}/approvals`),
        onError: (err) => {
          setActionError(err instanceof Error ? err.message : "Action failed");
        },
      },
    );
  }, [reject, proposalId, comment, navigate, projectSlug]);

  if (isLoading) return <ReviewSkeleton />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} className="m-6" />;
  if (!data || !proposal) return null;

  // Extract body strings for the diff
  const beforeBody =
    typeof before?.body === "string" ? before.body : JSON.stringify(before?.body ?? "", null, 2);
  const afterBody =
    typeof after?.body === "string" ? after.body : JSON.stringify(after?.body ?? "", null, 2);

  // Strip body from frontmatter records for the table
  const beforeMeta: Record<string, unknown> = { ...before };
  const afterMeta: Record<string, unknown> = { ...after };
  delete beforeMeta.body;
  delete afterMeta.body;

  return (
    <div className="flex flex-col h-full">
      {/* Sticky header */}
      <header
        className="sticky top-0 z-10 border-b px-5 py-3 flex flex-col gap-2"
        style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}
      >
        <AppBreadcrumb
          segments={[
            { label: "Approvals", href: `/p/${projectSlug}/approvals` },
            { label: proposal.proposed_title },
          ]}
          showHome
        />

        <div className="flex flex-wrap items-center gap-3">
          <h1
            className="flex-1 min-w-0 text-[15px] font-semibold leading-snug tracking-tight"
            style={{ color: "var(--fg-default)" }}
          >
            {proposal.proposed_title}
          </h1>

          <span
            className="shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              color: proposal.status === "open" ? "var(--feedback-info-fg)" : "var(--fg-muted)",
              background:
                proposal.status === "open"
                  ? "color-mix(in srgb, var(--feedback-info-fg) 12%, transparent)"
                  : "var(--bg-surface-2)",
            }}
          >
            {proposal.status}
          </span>

          <span
            className="shrink-0 text-[11px] font-mono"
            style={{ color: "var(--fg-muted)" }}
          >
            {proposal.kind}
          </span>

          {proposal.content_id && (
            <Link
              to={`/p/${projectSlug}/${proposal.kind === "testcase" ? "library" : proposal.kind === "shared_step" ? "shared-steps" : "stories"}/${proposal.content_id}`}
              className="shrink-0 inline-flex items-center gap-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded-sm"
              style={{ color: "var(--accent-fg)" }}
            >
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              View content
            </Link>
          )}
        </div>

        {/* Rendered / Raw toggle */}
        <div
          className="flex items-center gap-0 self-start rounded-md overflow-hidden"
          style={{ border: "1px solid var(--border-default)" }}
          role="group"
          aria-label="Diff view mode"
        >
          {(["rendered", "raw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setDiffMode(m)}
              className="px-3 py-1 text-[11px] font-medium capitalize outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--focus-ring)]"
              style={
                diffMode === m
                  ? { background: "var(--accent-soft)", color: "var(--accent-fg)" }
                  : { background: "transparent", color: "var(--fg-muted)" }
              }
              aria-pressed={diffMode === m}
            >
              {m}
            </button>
          ))}
        </div>
      </header>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 max-w-5xl">
        {/* Frontmatter diff */}
        {(Object.keys(beforeMeta).length > 0 || Object.keys(afterMeta).length > 0) && (
          <section aria-labelledby="frontmatter-diff-heading">
            <h2
              id="frontmatter-diff-heading"
              className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--fg-muted)" }}
            >
              Frontmatter changes
            </h2>
            <FrontmatterDiffTable before={beforeMeta} after={afterMeta} />
          </section>
        )}

        {/* Body diff */}
        <section aria-labelledby="body-diff-heading">
          <h2
            id="body-diff-heading"
            className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--fg-muted)" }}
          >
            Body diff
          </h2>
          <MarkdownDiffSplit
            before={beforeBody}
            after={afterBody}
            mode={diffMode}
            className="min-h-[320px] max-h-[60vh]"
          />
        </section>

        {/* Event timeline */}
        {events.length > 0 && (
          <section aria-label="Event history">
            <EventTimeline events={events} />
          </section>
        )}
      </div>

      {/* Docked action panel */}
      <div
        className="shrink-0 border-t px-6 py-4 flex flex-col gap-3"
        style={{ borderColor: "var(--border-default)", background: "var(--bg-surface-1)" }}
      >
        {isActionable ? (
          <>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional comment…"
              rows={2}
              className={cn(
                "w-full rounded-md border px-3 py-2 text-[13px] resize-none outline-none",
                "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]/30",
                "focus-visible:border-[color:var(--focus-ring)]",
                "placeholder:text-[color:var(--fg-disabled)]",
              )}
              style={{
                background: "var(--bg-surface-1)",
                border: "1px solid var(--border-default)",
                color: "var(--fg-default)",
              }}
            />

            {actionError && (
              <p
                className="text-[12px] rounded-md px-3 py-2"
                style={{
                  background: "var(--feedback-error-bg)",
                  color: "var(--feedback-error-fg)",
                  border: "1px solid color-mix(in srgb, var(--feedback-error-fg) 20%, transparent)",
                }}
              >
                {actionError}
              </p>
            )}

            <div className="flex items-center gap-3 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReject}
                disabled={rejecting || approving}
                className="text-[color:var(--feedback-error-fg)] hover:bg-[color:var(--feedback-error-bg)]"
              >
                {rejecting ? "Rejecting…" : "Reject"}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleApprove}
                disabled={approving || rejecting}
              >
                {approving ? "Approving…" : "Approve and publish"}
              </Button>
            </div>
          </>
        ) : (
          <p
            className="text-[12px] text-center py-1"
            style={{ color: "var(--fg-muted)" }}
          >
            {isAuthor
              ? "You cannot approve your own proposal. Waiting for a reviewer."
              : proposal.status !== "open"
                ? `This proposal is ${proposal.status} and cannot be acted upon.`
                : "You do not have permission to approve or reject proposals."}
          </p>
        )}
      </div>
    </div>
  );
}
