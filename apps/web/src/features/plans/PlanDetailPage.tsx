/**
 * PlanDetailPage — SP3.4 Task 43
 *
 * Design decisions (frontend-design skill invocation, Task 43):
 * - Utilitarian editorial aesthetic: information-dense header, clear
 *   typographic hierarchy, no decorative chrome. Every element is signal.
 * - Header layout: wombat_id monospace breadcrumb / title / status badge;
 *   action strip (Start run / Edit / Clone / Dashboard) right-aligned.
 * - Status badge: non-color discriminator triple (icon prefix letter + shape
 *   + color token) matching PlansListPage pattern for visual coherence.
 * - Metadata grid: two-column at sm+, single column mobile. Labeled pairs
 *   with clear hierarchy label=fg-muted, value=fg-default.
 * - Resolved case list: virtualized via EntityTable. Each row shows wombat_id
 *   (monospace), title, suite path breadcrumb (fg-muted, truncated).
 * - Warnings panel: amber left-rule callout — same style as ErrorState but
 *   uses feedback-warn tokens.
 * - "Start run" mutates via useStartRunDraft then navigates to runs/new with
 *   planDraft in router state. Pending state shows a spinner in the button.
 * - Clone: dialog (radix Dialog) with new_wombat_id + optional title fields.
 *   On success navigates to the new plan's detail page.
 * - Three page states: Loading (skeleton matching header+grid+list heights),
 *   Error (ErrorState), populated.
 * - Empty resolved cases: EmptyState with "No cases resolved" + link to edit.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Play,
  Pencil,
  Copy,
  BarChart2,
  AlertTriangle,
  Users,
  Globe,
  CheckSquare,
  Tag,
  ChevronRight,
  LayoutList,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EntityTable } from "@/components/shared/EntityTable";
import { ErrorState } from "@/components/shared/ErrorState";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";
import {
  usePlanDetail,
  useResolvePlan,
  useStartRunDraft,
  useClonePlan,
  type ResolvedCase,
} from "./hooks";

// ---------------------------------------------------------------------------
// Status badge (mirrors PlansListPage.StatusPill)
// ---------------------------------------------------------------------------

type PlanStatus = "Draft" | "Active" | "Archived";

function derivePlanStatus(tags: string[]): PlanStatus {
  const lower = tags.map((t) => t.toLowerCase());
  if (lower.includes("archived")) return "Archived";
  if (lower.includes("active")) return "Active";
  return "Draft";
}

const STATUS_STYLES: Record<
  PlanStatus,
  { bg: string; fg: string; border: string; prefix: string }
> = {
  Draft: {
    bg: "var(--bg-surface-2)",
    fg: "var(--fg-muted)",
    border: "var(--border-default)",
    prefix: "D",
  },
  Active: {
    bg: "var(--feedback-success-bg)",
    fg: "var(--feedback-success-fg)",
    border: "var(--feedback-success-fg)",
    prefix: "A",
  },
  Archived: {
    bg: "var(--bg-surface-3)",
    fg: "var(--fg-disabled)",
    border: "var(--border-subtle)",
    prefix: "Z",
  },
};

function StatusBadge({ tags }: { tags: string[] }) {
  const status = derivePlanStatus(tags);
  const s = STATUS_STYLES[status];
  return (
    <span
      aria-label={`Status: ${status}`}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
      }}
    >
      <span
        aria-hidden="true"
        className="flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold shrink-0"
        style={{ background: s.fg, color: s.bg }}
      >
        {s.prefix}
      </span>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Action button primitives
// ---------------------------------------------------------------------------

interface ActionButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
  children: React.ReactNode;
  title?: string;
  type?: "button" | "submit" | "reset";
  "aria-label"?: string;
}

function ActionButton({
  onClick,
  disabled,
  variant = "secondary",
  className,
  children,
  title,
  type = "button",
  "aria-label": ariaLabel,
}: ActionButtonProps) {
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: "var(--accent-primary)",
      color: "var(--fg-inverse)",
      border: "none",
    },
    secondary: {
      background: "var(--bg-surface-2)",
      color: "var(--fg-default)",
      border: "1px solid var(--border-default)",
    },
    ghost: {
      background: "transparent",
      color: "var(--fg-muted)",
      border: "1px solid var(--border-default)",
    },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold",
        "transition-colors duration-120 outline-none",
        "focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
        "disabled:opacity-40 disabled:pointer-events-none",
        className,
      )}
      style={styles[variant]}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Clone dialog
// ---------------------------------------------------------------------------

interface CloneDialogProps {
  open: boolean;
  sourceWid: string;
  sourceTitle: string;
  slug: string;
  onClose: () => void;
  onSuccess: (newWid: string) => void;
}

function CloneDialog({
  open,
  sourceWid,
  sourceTitle,
  slug,
  onClose,
  onSuccess,
}: CloneDialogProps) {
  const [newWid, setNewWid] = useState("");
  const [title, setTitle] = useState("");
  const cloneMutation = useClonePlan(slug);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the ID input when the dialog opens
  useEffect(() => {
    if (open) {
      setNewWid("");
      setTitle("");
      cloneMutation.reset();
      // Micro-task to let the DOM mount
      setTimeout(() => inputRef.current?.focus(), 10);
    }
    // cloneMutation.reset is stable; we don't want to track the full mutation obj
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newWid.trim()) return;
    try {
      const result = await cloneMutation.mutateAsync({
        wombat_id: sourceWid,
        new_wombat_id: newWid.trim(),
        title: title.trim() || undefined,
      });
      onSuccess(result.new_wombat_id);
    } catch {
      // error shown inline
    }
  }

  return (
    /* Backdrop — outer layer closes on click; inner dialog is the interactive region */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "color-mix(in srgb, var(--bg-app) 60%, transparent)" }}
    >
      {/* Invisible close-target for pointer users who click outside the dialog */}
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 w-full h-full cursor-default"
        style={{ background: "transparent", border: "none" }}
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Clone plan"
        className="relative z-10 w-full max-w-md rounded-xl shadow-xl p-6 flex flex-col gap-5"
        style={{
          background: "var(--bg-surface-1)",
          border: "1px solid var(--border-default)",
        }}
      >
        <div className="flex flex-col gap-1">
          <h2
            className="text-[15px] font-semibold"
            style={{ color: "var(--fg-default)" }}
          >
            Clone plan
          </h2>
          <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
            Creates a copy of{" "}
            <span className="font-mono" style={{ color: "var(--accent-fg)" }}>
              {sourceWid}
            </span>{" "}
            &mdash; &ldquo;{sourceTitle}&rdquo; &mdash; as a new proposal pending review.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="clone-wid"
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--fg-muted)" }}
            >
              New plan ID
              <span aria-hidden="true" style={{ color: "var(--feedback-error-fg)" }}> *</span>
            </label>
            <input
              id="clone-wid"
              ref={inputRef}
              type="text"
              value={newWid}
              onChange={(e) => setNewWid(e.target.value)}
              required
              placeholder="e.g. PLAN-202506-payments"
              className={cn(
                "w-full rounded-md px-3 py-2 text-sm font-mono",
                "border outline-none transition-all",
                "focus:ring-2 focus:ring-[color:var(--focus-ring)]",
              )}
              style={{
                background: "var(--bg-surface-2)",
                border: "1px solid var(--border-default)",
                color: "var(--fg-default)",
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="clone-title"
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--fg-muted)" }}
            >
              Override title
              <span className="ml-1 font-normal normal-case tracking-normal" style={{ color: "var(--fg-disabled)" }}>
                (optional)
              </span>
            </label>
            <input
              id="clone-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`${sourceTitle} (copy)`}
              className={cn(
                "w-full rounded-md px-3 py-2 text-sm",
                "border outline-none transition-all",
                "focus:ring-2 focus:ring-[color:var(--focus-ring)]",
              )}
              style={{
                background: "var(--bg-surface-2)",
                border: "1px solid var(--border-default)",
                color: "var(--fg-default)",
              }}
            />
          </div>

          {cloneMutation.isError && (
            <p
              role="alert"
              className="text-xs"
              style={{ color: "var(--feedback-error-fg)" }}
            >
              {cloneMutation.error instanceof Error
                ? cloneMutation.error.message
                : "Clone failed. Please try again."}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <ActionButton variant="ghost" onClick={onClose} type="button">
              Cancel
            </ActionButton>
            <ActionButton
              variant="primary"
              disabled={cloneMutation.isPending || !newWid.trim()}
            >
              {cloneMutation.isPending ? "Cloning…" : "Clone plan"}
            </ActionButton>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata grid
// ---------------------------------------------------------------------------

interface MetaItemProps {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}

function MetaItem({ icon, label, children }: MetaItemProps) {
  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--fg-muted)" }}
      >
        <span className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
          {icon}
        </span>
        {label}
      </div>
      <div className="pl-5 text-[13px]" style={{ color: "var(--fg-default)" }}>
        {children}
      </div>
    </div>
  );
}

function EmptyMetaValue() {
  return <span style={{ color: "var(--fg-disabled)" }}>—</span>;
}

// ---------------------------------------------------------------------------
// Warnings panel
// ---------------------------------------------------------------------------

function WarningsPanel({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-2 px-4 py-3 rounded-md"
      style={{
        background: "var(--feedback-warn-bg)",
        border: "1px solid color-mix(in srgb, var(--feedback-warn-fg) 30%, transparent)",
        borderLeft: "3px solid var(--feedback-warn-fg)",
      }}
      role="alert"
    >
      <div
        className="flex items-center gap-2 text-[12px] font-semibold"
        style={{ color: "var(--feedback-warn-fg)" }}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {warnings.length === 1 ? "Warning" : `${warnings.length} warnings`}
      </div>
      <ul className="flex flex-col gap-1 pl-5 list-disc">
        {warnings.map((w, i) => (
          <li key={i} className="text-[12px]" style={{ color: "var(--feedback-warn-fg)" }}>
            {w}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolved cases column definitions
// ---------------------------------------------------------------------------

const RESOLVED_CASE_COLUMNS: ColumnDef<ResolvedCase>[] = [
  {
    id: "wombat_id",
    header: "ID",
    accessorKey: "wombat_id",
    size: 180,
    cell: ({ getValue }) => (
      <span
        className="font-mono text-[12px] font-medium"
        style={{ color: "var(--accent-fg)" }}
      >
        {getValue<string>()}
      </span>
    ),
  },
  {
    id: "title",
    header: "Title",
    accessorKey: "title",
    size: 0,
    meta: { className: "flex-1 min-w-0" },
    cell: ({ getValue }) => (
      <span
        className="truncate text-[13px] font-medium"
        style={{ color: "var(--fg-default)" }}
      >
        {getValue<string>()}
      </span>
    ),
  },
  {
    id: "suite_path",
    header: "Suite",
    size: 220,
    cell: ({ row }) => {
      const path = row.original.suite_path;
      if (!path || path.length === 0) {
        return <span style={{ color: "var(--fg-disabled)" }}>—</span>;
      }
      return (
        <span
          className="inline-flex items-center gap-1 truncate text-[11px]"
          style={{ color: "var(--fg-muted)" }}
          title={path.join(" › ")}
        >
          {path.map((segment, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 && (
                <ChevronRight
                  className="h-3 w-3 shrink-0 opacity-50"
                  aria-hidden="true"
                />
              )}
              <span className="truncate max-w-[80px]">{segment}</span>
            </span>
          ))}
        </span>
      );
    },
  },
];

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function PlanDetailSkeleton() {
  return (
    <div className="flex flex-col gap-0" aria-busy="true" aria-label="Loading plan">
      {/* Header skeleton */}
      <div
        className="sticky top-0 z-10 px-5 py-3 border-b flex flex-col gap-2"
        style={{
          background: "var(--bg-app)",
          borderColor: "var(--border-default)",
        }}
      >
        {/* Breadcrumb + actions row */}
        <div className="flex items-center justify-between">
          <div
            className="h-3 w-24 rounded animate-pulse"
            style={{ background: "var(--bg-surface-3)" }}
          />
          <div className="flex items-center gap-2">
            {[80, 56, 64, 80].map((w, i) => (
              <div
                key={i}
                className="rounded-md animate-pulse"
                style={{ height: 30, width: w, background: "var(--bg-surface-3)" }}
              />
            ))}
          </div>
        </div>
        {/* Title row */}
        <div className="flex items-center gap-3">
          <div
            className="h-5 w-48 rounded animate-pulse"
            style={{ background: "var(--bg-surface-3)" }}
          />
          <div
            className="h-5 w-16 rounded-full animate-pulse"
            style={{ background: "var(--bg-surface-3)" }}
          />
        </div>
      </div>

      {/* Metadata skeleton */}
      <div className="px-5 py-5 border-b grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        style={{ borderColor: "var(--border-default)" }}>
        {[100, 120, 140, 80].map((w, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div
              className="h-2.5 rounded animate-pulse"
              style={{ width: w / 2, background: "var(--bg-surface-3)" }}
            />
            <div
              className="h-3.5 rounded animate-pulse"
              style={{ width: w, background: "var(--bg-surface-3)" }}
            />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div className="flex flex-col">
        <div
          className="flex items-center px-3 border-b"
          style={{ height: 34, borderColor: "var(--border-default)", background: "var(--bg-surface-2)" }}
        >
          {[180, 0, 220].map((w, i) => (
            <div
              key={i}
              className="px-3"
              style={{ width: w || undefined, flex: w === 0 ? 1 : undefined }}
            >
              <div
                className="h-2.5 w-10 rounded animate-pulse"
                style={{ background: "var(--bg-surface-3)" }}
              />
            </div>
          ))}
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center px-3 border-b"
            style={{ height: 36, borderColor: "var(--border-subtle)" }}
          >
            <div className="px-3" style={{ width: 180 }}>
              <div
                className="h-3 w-28 rounded animate-pulse"
                style={{ background: "var(--bg-surface-3)" }}
              />
            </div>
            <div className="flex-1 px-3">
              <div
                className="h-3 rounded animate-pulse"
                style={{
                  background: "var(--bg-surface-3)",
                  width: `${40 + (i % 4) * 12}%`,
                }}
              />
            </div>
            <div className="px-3" style={{ width: 220 }}>
              <div
                className="h-3 rounded animate-pulse"
                style={{ background: "var(--bg-surface-3)", width: 100 }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PlanDetailPage
// ---------------------------------------------------------------------------

export function PlanDetailPage() {
  const { projectSlug = "", wid = "" } = useParams<{
    projectSlug: string;
    wid: string;
  }>();
  const navigate = useNavigate();

  const planQuery = usePlanDetail(projectSlug, wid);
  const resolveQuery = useResolvePlan(projectSlug, wid);
  const startRunMutation = useStartRunDraft(projectSlug, wid);

  const [cloneOpen, setCloneOpen] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);

  // Keyboard shortcuts: e=edit, c=clone, d=dashboard, s=start run
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isEditing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;
      if (isEditing) return;

      if (e.key === "e" && !e.metaKey && !e.ctrlKey) {
        navigate(`/p/${projectSlug}/plans/${wid}/edit`);
        return;
      }
      if (e.key === "c" && !e.metaKey && !e.ctrlKey) {
        setCloneOpen(true);
        return;
      }
      if (e.key === "d" && !e.metaKey && !e.ctrlKey) {
        navigate(`/p/${projectSlug}/plans/${wid}/dashboard`);
        return;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [navigate, projectSlug, wid]);

  const handleStartRun = useCallback(async () => {
    setIsStartingRun(true);
    try {
      const planDraft = await startRunMutation.mutateAsync();
      navigate(`/p/${projectSlug}/runs/new`, { state: { planDraft } });
    } catch {
      // Error is surfaced via startRunMutation.isError
      setIsStartingRun(false);
    }
  }, [startRunMutation, navigate, projectSlug]);

  const handleCloneSuccess = useCallback(
    (newWid: string) => {
      setCloneOpen(false);
      navigate(`/p/${projectSlug}/plans/${newWid}`);
    },
    [navigate, projectSlug],
  );

  // ----- Loading state -----
  if (planQuery.isLoading) {
    return <PlanDetailSkeleton />;
  }

  // ----- Error state -----
  if (planQuery.isError || !planQuery.data) {
    return (
      <div className="px-5 py-10">
        <ErrorState
          error={planQuery.error ?? new Error("Plan not found")}
          onRetry={() => void planQuery.refetch()}
          title="Failed to load plan"
        />
      </div>
    );
  }

  const plan = planQuery.data;
  const body = plan.body;

  // Derive release tag from tags or body.release field (body is untyped at this level)
  const releaseTag =
    (body as Record<string, unknown>).release as string | undefined ||
    plan.tags.find(
      (t) => t.startsWith("release:") || /^v\d/.test(t),
    );
  const releaseLabel = releaseTag?.startsWith("release:")
    ? releaseTag.slice(8)
    : releaseTag;

  const environments = (body.environments ?? []) as string[];
  const assignees = (body.assignees ?? []) as string[];
  const approvals = body.approvals as Record<string, unknown> | undefined;
  const approvalsRequired =
    approvals && typeof approvals === "object"
      ? Object.keys(approvals).length
      : 0;

  // Derive warnings: if the plan has no cases resolved and the resolve query
  // succeeded, surface a "no cases resolved" advisory.
  const warnings: string[] = [];
  if (
    resolveQuery.isSuccess &&
    resolveQuery.data &&
    resolveQuery.data.total === 0
  ) {
    warnings.push(
      "This plan resolves to 0 test cases. Check your filters and suite references.",
    );
  }

  return (
    <div className="flex flex-col h-full" data-page="plan-detail">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <header
        className="sticky top-0 z-10 flex flex-col gap-1 px-5 pt-3 pb-3 border-b shrink-0"
        style={{
          background: "var(--bg-app)",
          borderColor: "var(--border-default)",
        }}
      >
        {/* Breadcrumb + actions */}
        <div className="flex items-center justify-between gap-3">
          {/* Breadcrumb: Plans > plan wid */}
          <div
            className="flex items-center gap-1 text-[12px] min-w-0"
            style={{ color: "var(--fg-muted)" }}
          >
            <Link
              to={`/p/${projectSlug}/plans`}
              className="hover:underline truncate"
              style={{ color: "var(--fg-muted)" }}
            >
              Plans
            </Link>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
            <span
              className="font-mono text-[11px] truncate"
              style={{ color: "var(--accent-fg)" }}
            >
              {plan.wombat_id}
            </span>
          </div>

          {/* Action strip */}
          <div className="flex items-center gap-2 shrink-0">
            <ActionButton
              variant="primary"
              onClick={() => void handleStartRun()}
              disabled={isStartingRun || startRunMutation.isPending}
              aria-label="Start a run from this plan"
            >
              {isStartingRun || startRunMutation.isPending ? (
                <>
                  <span
                    className="h-3.5 w-3.5 rounded-full border-2 border-t-transparent animate-spin"
                    style={{
                      borderColor: "var(--fg-inverse)",
                      borderTopColor: "transparent",
                    }}
                    aria-hidden="true"
                  />
                  Starting…
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  Start run
                </>
              )}
            </ActionButton>

            <ActionButton
              variant="secondary"
              onClick={() =>
                navigate(`/p/${projectSlug}/plans/${wid}/edit`)
              }
              aria-label="Edit this plan"
              title="Edit (e)"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </ActionButton>

            <ActionButton
              variant="secondary"
              onClick={() => setCloneOpen(true)}
              aria-label="Clone this plan"
              title="Clone (c)"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Clone
            </ActionButton>

            <ActionButton
              variant="secondary"
              onClick={() =>
                navigate(`/p/${projectSlug}/plans/${wid}/dashboard`)
              }
              aria-label="Open plan dashboard"
              title="Dashboard (d)"
            >
              <BarChart2 className="h-3.5 w-3.5" aria-hidden="true" />
              Dashboard
            </ActionButton>
          </div>
        </div>

        {/* Title + status badge */}
        <div className="flex items-center gap-3 min-w-0">
          <h1
            className="text-[15px] font-semibold truncate"
            style={{ color: "var(--fg-default)" }}
          >
            {plan.title || plan.wombat_id}
          </h1>
          <StatusBadge tags={plan.tags} />
          {startRunMutation.isError && (
            <span
              className="text-[11px] ml-2"
              style={{ color: "var(--feedback-error-fg)" }}
              role="alert"
            >
              {startRunMutation.error instanceof Error
                ? startRunMutation.error.message
                : "Failed to start run"}
            </span>
          )}
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Metadata grid                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section
        aria-label="Plan metadata"
        className="shrink-0 px-5 py-4 border-b grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-4"
        style={{
          background: "var(--bg-surface-1)",
          borderColor: "var(--border-default)",
        }}
      >
        <MetaItem icon={<Tag className="h-3.5 w-3.5" />} label="Release">
          {releaseLabel ? (
            <span className="font-mono text-[12px]">{releaseLabel}</span>
          ) : (
            <EmptyMetaValue />
          )}
        </MetaItem>

        <MetaItem icon={<Globe className="h-3.5 w-3.5" />} label="Environments">
          {environments.length > 0 ? (
            <span className="text-[13px]">{environments.join(", ")}</span>
          ) : (
            <EmptyMetaValue />
          )}
        </MetaItem>

        <MetaItem icon={<Users className="h-3.5 w-3.5" />} label="Assignees">
          {assignees.length > 0 ? (
            <span className="text-[13px]">{assignees.join(", ")}</span>
          ) : (
            <EmptyMetaValue />
          )}
        </MetaItem>

        <MetaItem icon={<CheckSquare className="h-3.5 w-3.5" />} label="Approvals required">
          {approvalsRequired > 0 ? (
            <span className="text-[13px]">{approvalsRequired}</span>
          ) : (
            <EmptyMetaValue />
          )}
        </MetaItem>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Warnings panel (if any)                                              */}
      {/* ------------------------------------------------------------------ */}
      {warnings.length > 0 && (
        <div className="px-5 pt-4 shrink-0">
          <WarningsPanel warnings={warnings} />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Resolved cases                                                       */}
      {/* ------------------------------------------------------------------ */}
      <section
        aria-label="Resolved test cases"
        className="flex flex-col flex-1 min-h-0"
      >
        {/* Sub-header */}
        <PageHeader
          title="Resolved cases"
          count={
            resolveQuery.isSuccess
              ? (resolveQuery.data?.total ?? 0)
              : undefined
          }
        />

        {resolveQuery.isLoading ? (
          /* Skeleton for the cases list while resolving */
          <div aria-busy="true" aria-label="Loading resolved cases">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center px-3 border-b"
                style={{ height: 36, borderColor: "var(--border-subtle)" }}
              >
                <div className="px-3" style={{ width: 180 }}>
                  <div
                    className="h-3 w-28 rounded animate-pulse"
                    style={{ background: "var(--bg-surface-3)" }}
                  />
                </div>
                <div className="flex-1 px-3">
                  <div
                    className="h-3 rounded animate-pulse"
                    style={{
                      background: "var(--bg-surface-3)",
                      width: `${45 + (i % 3) * 15}%`,
                    }}
                  />
                </div>
                <div className="px-3" style={{ width: 220 }}>
                  <div
                    className="h-3 rounded animate-pulse"
                    style={{ background: "var(--bg-surface-3)", width: 90 }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : resolveQuery.isError ? (
          <ErrorState
            error={resolveQuery.error}
            onRetry={() => void resolveQuery.refetch()}
            title="Failed to resolve cases"
            className="px-5 py-8"
          />
        ) : !resolveQuery.data || resolveQuery.data.total === 0 ? (
          <EmptyState
            icon={<LayoutList className="h-4 w-4" aria-hidden="true" />}
            title="No cases resolved"
            description="This plan's filters, suite references, and explicit cases resolve to 0 test cases. Edit the plan to adjust its configuration."
            action={
              <ActionButton
                variant="secondary"
                onClick={() =>
                  navigate(`/p/${projectSlug}/plans/${wid}/edit`)
                }
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit plan
              </ActionButton>
            }
            className="px-5 py-8"
          />
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <EntityTable
              data={resolveQuery.data.resolved_cases}
              columns={RESOLVED_CASE_COLUMNS}
              density="compact"
              getRowId={(row) => row.wombat_id}
              aria-label="Resolved test cases"
              className="h-full"
              onRowClick={(row) =>
                navigate(`/p/${projectSlug}/library/${row.wombat_id}`)
              }
            />
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Keyboard hint bar                                                    */}
      {/* ------------------------------------------------------------------ */}
      <div
        className="flex items-center gap-3 px-5 py-1.5 border-t text-[11px] shrink-0"
        style={{
          borderColor: "var(--border-default)",
          background: "var(--bg-surface-2)",
          color: "var(--fg-disabled)",
        }}
      >
        {[
          { key: "e", label: "edit" },
          { key: "c", label: "clone" },
          { key: "d", label: "dashboard" },
        ].map(({ key, label }) => (
          <span key={key}>
            <kbd
              className="rounded px-1 py-0.5 font-mono text-[10px]"
              style={{
                background: "var(--bg-surface-3)",
                border: "1px solid var(--border-default)",
              }}
            >
              {key}
            </kbd>
            {" "}{label}
          </span>
        ))}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Clone dialog                                                          */}
      {/* ------------------------------------------------------------------ */}
      <CloneDialog
        open={cloneOpen}
        sourceWid={plan.wombat_id}
        sourceTitle={plan.title}
        slug={projectSlug}
        onClose={() => setCloneOpen(false)}
        onSuccess={handleCloneSuccess}
      />
    </div>
  );
}
