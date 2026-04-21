/**
 * ApprovalsInboxPage — virtualized list of proposals for the current project.
 *
 * Design (from frontend-design skill):
 * - Filter pill bar above EntityTable (status, kind, agent-only toggle)
 * - Status column pill: open/conflict/published/rejected/withdrawn
 * - Author badge: human vs agent (robot icon)
 * - Change-size chip: +N / -N in green/red
 * - Toggleable preview pane via SP3.1 PreviewPane pattern
 * - Keyboard: j/k navigate rows, o open, a approve (admin), r reject (admin), w withdraw (author)
 * - Three states: Loading (skeleton rows), Empty, Error
 */

import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bot, User, AlertCircle, ChevronDown } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/PageHeader";
import { EntityTable } from "@/components/shared/EntityTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { MarkdownDiffSplit } from "@/components/shared/MarkdownDiffSplit";
import {
  useProposals,
  useApproveProposal,
  useRejectProposal,
  useWithdrawProposal,
  type ProposalSummary,
} from "./api";
import { usePermission } from "@/features/auth/useSession";
import { useSession } from "@/features/auth/useSession";
import { useShortcut } from "@/lib/shortcuts/useShortcut";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  open: {
    label: "Open",
    color: "var(--feedback-info-fg)",
    bg: "color-mix(in srgb, var(--feedback-info-fg) 12%, transparent)",
  },
  conflict: {
    label: "Conflict",
    color: "var(--feedback-error-fg)",
    bg: "color-mix(in srgb, var(--feedback-error-fg) 12%, transparent)",
  },
  published: {
    label: "Published",
    color: "var(--feedback-success-fg)",
    bg: "color-mix(in srgb, var(--feedback-success-fg) 12%, transparent)",
  },
  rejected: {
    label: "Rejected",
    color: "var(--fg-muted)",
    bg: "var(--bg-surface-2)",
  },
  withdrawn: {
    label: "Withdrawn",
    color: "var(--fg-disabled)",
    bg: "var(--bg-surface-2)",
  },
};

function StatusPill({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? {
    label: status,
    color: "var(--fg-muted)",
    bg: "var(--bg-surface-2)",
  };
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
  );
}

function AuthorBadge({ kind }: { kind: string }) {
  if (kind === "agent") {
    return (
      <span
        title="Agent-authored proposal"
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
        style={{
          color: "var(--chart-cat-4)",
          background: "color-mix(in srgb, var(--chart-cat-4) 12%, transparent)",
        }}
      >
        <Bot className="h-3 w-3" aria-hidden="true" />
        Agent
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{
        color: "var(--fg-muted)",
        background: "var(--bg-surface-2)",
      }}
    >
      <User className="h-3 w-3" aria-hidden="true" />
      Human
    </span>
  );
}

function ChangeChip({ added, removed }: { added: number; removed: number }) {
  return (
    <div className="flex items-center gap-1 font-mono text-[10px]">
      {added > 0 && (
        <span style={{ color: "var(--feedback-success-fg)" }}>+{added}</span>
      )}
      {removed > 0 && (
        <span style={{ color: "var(--feedback-error-fg)" }}>-{removed}</span>
      )}
      {added === 0 && removed === 0 && (
        <span style={{ color: "var(--fg-disabled)" }}>—</span>
      )}
    </div>
  );
}

function relativeAge(isoDate: string): string {
  const delta = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/* ------------------------------------------------------------------ */
/* Filter pills                                                         */
/* ------------------------------------------------------------------ */

type StatusFilter = "all" | "open" | "conflict" | "published" | "rejected" | "withdrawn";
type KindFilter = "all" | "testcase" | "shared_step" | "story";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "conflict", label: "Conflict" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: "all", label: "All kinds" },
  { value: "testcase", label: "Testcase" },
  { value: "shared_step", label: "Shared step" },
  { value: "story", label: "Story" },
];

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-[11px] font-medium transition-colors duration-100",
        "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
      )}
      style={
        active
          ? {
              background: "var(--accent-primary)",
              color: "var(--accent-fg)",
            }
          : {
              background: "var(--bg-surface-2)",
              color: "var(--fg-muted)",
              border: "1px solid var(--border-default)",
            }
      }
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Skeleton                                                             */
/* ------------------------------------------------------------------ */

function InboxSkeleton() {
  return (
    <div className="flex flex-col" aria-busy="true" aria-label="Loading proposals">
      {/* Filter bar skeleton */}
      <div
        className="flex items-center gap-2 px-5 py-3 border-b"
        style={{ borderColor: "var(--border-default)" }}
      >
        {[60, 50, 70, 55, 65].map((w, i) => (
          <div
            key={i}
            className="h-6 rounded-full animate-pulse"
            style={{ width: w, background: "var(--bg-surface-3)" }}
          />
        ))}
      </div>
      {/* Row skeletons */}
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-5 py-3 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="h-4 w-20 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          <div className="h-4 flex-1 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          <div className="h-4 w-14 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          <div className="h-4 w-10 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preview pane                                                         */
/* ------------------------------------------------------------------ */

function MiniPreview({ proposal }: { proposal: ProposalSummary | null }) {
  if (!proposal) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: "var(--fg-disabled)" }}
      >
        <p className="text-[12px]">Select a proposal to preview</p>
      </div>
    );
  }

  const body = proposal.proposed_title ?? "";
  const before = "";
  const after = body;

  return (
    <div className="flex flex-col gap-3 p-4 overflow-auto h-full">
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--fg-muted)" }}>
        Preview — {proposal.proposed_title}
      </p>
      <MarkdownDiffSplit before={before} after={after} mode="rendered" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main page                                                            */
/* ------------------------------------------------------------------ */

export function ApprovalsInboxPage() {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const { user } = useSession();
  const canApprove = usePermission(projectSlug, "content:publish_direct");
  const canPropose = usePermission(projectSlug, "content:propose");

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [agentOnly, setAgentOnly] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const filters = {
    status: statusFilter === "all" ? undefined : statusFilter,
    kind: kindFilter === "all" ? undefined : kindFilter,
    author_kind: agentOnly ? "agent" : undefined,
  };

  const { data, isLoading, isError, error, refetch } = useProposals(projectSlug, filters);
  const { mutate: approve } = useApproveProposal(projectSlug);
  const { mutate: reject } = useRejectProposal(projectSlug);
  const { mutate: withdraw } = useWithdrawProposal(projectSlug);

  const proposals = data?.data ?? [];
  const selected = proposals.find((p) => p.id === selectedId) ?? null;

  const openSelected = useCallback(() => {
    if (selectedId) navigate(`/p/${projectSlug}/approvals/${selectedId}`);
  }, [selectedId, navigate, projectSlug]);

  // Keyboard shortcuts scoped to this page
  useShortcut("o", (e) => { e.preventDefault(); openSelected(); }, { enabled: Boolean(selectedId) });
  useShortcut("a", (e) => {
    e.preventDefault();
    if (canApprove && selectedId) {
      approve({ proposalId: selectedId, body: {} });
    }
  }, { enabled: Boolean(selectedId && canApprove) });
  useShortcut("r", (e) => {
    e.preventDefault();
    if (canApprove && selectedId) {
      reject({ proposalId: selectedId, body: {} });
    }
  }, { enabled: Boolean(selectedId && canApprove) });
  useShortcut("w", (e) => {
    e.preventDefault();
    if (canPropose && selectedId) {
      const p = proposals.find((x) => x.id === selectedId);
      if (p && p.author_user_id === user?.id) {
        withdraw({ proposalId: selectedId });
      }
    }
  }, { enabled: Boolean(selectedId && canPropose) });

  const columns: ColumnDef<ProposalSummary>[] = [
    {
      id: "status",
      header: "Status",
      size: 110,
      cell: ({ row }) => <StatusPill status={row.original.status} />,
    },
    {
      id: "kind",
      header: "Kind",
      size: 90,
      cell: ({ row }) => (
        <span
          className="text-[11px] font-mono"
          style={{ color: "var(--fg-muted)" }}
        >
          {row.original.kind}
        </span>
      ),
    },
    {
      id: "title",
      header: "Title",
      cell: ({ row }) => (
        <span
          className="text-[13px] truncate"
          style={{ color: "var(--fg-default)" }}
          title={row.original.proposed_title}
        >
          {row.original.proposed_title}
        </span>
      ),
    },
    {
      id: "author",
      header: "Author",
      size: 100,
      cell: ({ row }) => <AuthorBadge kind={row.original.author_kind} />,
    },
    {
      id: "changes",
      header: "Changes",
      size: 80,
      cell: ({ row }) => (
        <ChangeChip
          added={row.original.change_added}
          removed={row.original.change_removed}
        />
      ),
    },
    {
      id: "age",
      header: "Age",
      size: 56,
      cell: ({ row }) => (
        <span
          className="text-[11px] tabular-nums"
          style={{ color: "var(--fg-muted)" }}
          title={row.original.created_at}
        >
          {relativeAge(row.original.created_at)}
        </span>
      ),
    },
  ];

  if (isLoading) return <InboxSkeleton />;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Approvals"
        subtitle="Review and act on proposed content changes"
        actions={
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 h-7 text-[12px] font-medium",
              "transition-colors duration-100 outline-none",
              "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
            )}
            style={
              showPreview
                ? { background: "var(--accent-soft)", color: "var(--accent-fg)" }
                : {
                    background: "var(--bg-surface-2)",
                    color: "var(--fg-muted)",
                    border: "1px solid var(--border-default)",
                  }
            }
            aria-pressed={showPreview}
          >
            Preview
          </button>
        }
      />

      {/* Filter bar */}
      <div
        className="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b shrink-0"
        style={{ borderColor: "var(--border-default)" }}
        role="toolbar"
        aria-label="Proposal filters"
      >
        <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Status filter">
          {STATUS_OPTIONS.map((opt) => (
            <FilterPill
              key={opt.value}
              active={statusFilter === opt.value}
              onClick={() => setStatusFilter(opt.value)}
            >
              {opt.label}
            </FilterPill>
          ))}
        </div>

        <div
          className="w-px h-5 self-center"
          aria-hidden="true"
          style={{ background: "var(--border-default)" }}
        />

        <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Kind filter">
          {KIND_OPTIONS.map((opt) => (
            <FilterPill
              key={opt.value}
              active={kindFilter === opt.value}
              onClick={() => setKindFilter(opt.value)}
            >
              {opt.label}
            </FilterPill>
          ))}
        </div>

        <div
          className="w-px h-5 self-center"
          aria-hidden="true"
          style={{ background: "var(--border-default)" }}
        />

        <FilterPill active={agentOnly} onClick={() => setAgentOnly((v) => !v)}>
          <Bot className="inline h-3 w-3 mr-1" aria-hidden="true" />
          Agent only
        </FilterPill>

        {proposals.length > 0 && (
          <span
            className="ml-auto text-[11px] tabular-nums"
            style={{ color: "var(--fg-muted)" }}
          >
            {proposals.length} result{proposals.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Table + states */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {isError ? (
            <ErrorState error={error} onRetry={() => void refetch()} className="m-6" />
          ) : proposals.length === 0 ? (
            <EmptyState
              icon={<AlertCircle className="h-4 w-4" aria-hidden="true" />}
              title="No proposals"
              description={
                statusFilter === "open"
                  ? "There are no open proposals waiting for review."
                  : "No proposals match the selected filters."
              }
              action={
                statusFilter !== "all" ? (
                  <button
                    type="button"
                    onClick={() => { setStatusFilter("all"); setKindFilter("all"); setAgentOnly(false); }}
                    className="text-[12px] underline outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] rounded-sm"
                    style={{ color: "var(--accent-fg)" }}
                  >
                    Clear filters
                  </button>
                ) : undefined
              }
            />
          ) : (
            <EntityTable
              data={proposals}
              columns={columns}
              getRowId={(row) => row.id}
              selectedId={selectedId}
              aria-label="Proposals inbox"
              onRowClick={(row) => {
                setSelectedId(row.id);
                navigate(`/p/${projectSlug}/approvals/${row.id}`);
              }}
            />
          )}
        </div>

        {/* Preview pane */}
        {showPreview && (
          <div
            className="w-[360px] shrink-0 border-l overflow-hidden flex flex-col"
            style={{
              borderColor: "var(--border-default)",
              background: "var(--bg-surface-1)",
            }}
          >
            <MiniPreview proposal={selected} />
          </div>
        )}
      </div>

      {/* Keyboard hint footer */}
      <div
        className="shrink-0 border-t px-5 py-2 flex items-center gap-4 text-[10px]"
        style={{
          borderColor: "var(--border-subtle)",
          color: "var(--fg-disabled)",
        }}
      >
        <span><kbd className="font-mono">j/k</kbd> navigate</span>
        <span><kbd className="font-mono">o</kbd> open</span>
        {canApprove && <span><kbd className="font-mono">a</kbd> approve · <kbd className="font-mono">r</kbd> reject</span>}
        {canPropose && <span><kbd className="font-mono">w</kbd> withdraw</span>}
        <ChevronDown className="h-3 w-3 ml-auto" aria-hidden="true" />
      </div>
    </div>
  );
}
