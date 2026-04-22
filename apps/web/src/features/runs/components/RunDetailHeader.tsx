/**
 * RunDetailHeader — sticky header for the Run Detail page.
 *
 * Layout (top-to-bottom):
 *   1. Breadcrumb row: Runs › {title}
 *   2. Title + status chip row + primary actions (Execute →, Close, …)
 *   3. Counts strip: ✓ pass  ✗ fail  ⊘ blocked  ⤼ skipped  ◌ not_run
 *   4. Meta row: environment chip + assignee chips (click → assignee popover)
 *
 * Actions:
 *   Primary  — Execute → (navigate to /p/:slug/runs/:id/execute)
 *   Secondary — Close (opens CloseDialog: completed/aborted radio + note)
 *   Overflow  — ⋯ menu: Rerun failed / Rerun all / Edit metadata / Abort / Reopen (admin)
 *
 * Design tokens: all colors via CSS variables, no hex literals.
 * SP3.3 Task 45.
 */

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Play,
  XCircle,
  MoreHorizontal,
  RefreshCw,
  Settings2,
  Lock,
  Unlock,
  Globe,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppBreadcrumb } from "@/components/shared/AppBreadcrumb";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { usePermission } from "@/features/auth/useSession";
import {
  useCloseRun,
  useReopenRun,
  useRerun,
  useUpdateRun,
  type RunSummary,
} from "../hooks/runs";
import { useEnvironments } from "../hooks/environments";
import { RunStatusChip } from "./RunStatusChip";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RunDetailHeaderProps {
  run: RunSummary;
}

// ---------------------------------------------------------------------------
// Counts strip
// ---------------------------------------------------------------------------

interface CountBadgeProps {
  icon: string;
  value: number;
  tokenBg: string;
  tokenFg: string;
  label: string;
}

function CountBadge({ icon, value, tokenBg, tokenFg, label }: CountBadgeProps) {
  return (
    <span
      aria-label={`${value} ${label}`}
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
      style={{
        background: `var(${tokenBg})`,
        color: `var(${tokenFg})`,
      }}
    >
      <span aria-hidden="true">{icon}</span>
      {value}
    </span>
  );
}

function CountsStrip({ run }: { run: RunSummary }) {
  const total = run.total_cases ?? 0;
  const pass = run.passed ?? 0;
  const fail = run.failed ?? 0;
  const blocked = run.blocked ?? 0;
  const skipped = run.skipped ?? 0;
  const notRun = run.not_run ?? (total - pass - fail - blocked - skipped);

  return (
    <div
      className="flex items-center gap-1.5 flex-wrap"
      aria-label="Case result counts"
    >
      <span
        className="text-[11px] font-medium tabular-nums"
        style={{ color: "var(--fg-muted)" }}
      >
        {total} case{total !== 1 ? "s" : ""}
      </span>
      <span aria-hidden="true" style={{ color: "var(--border-default)" }}>·</span>
      <CountBadge
        icon="✓"
        value={pass}
        tokenBg="--result-pass-bg"
        tokenFg="--result-pass-fg"
        label="passed"
      />
      <CountBadge
        icon="✗"
        value={fail}
        tokenBg="--result-fail-bg"
        tokenFg="--result-fail-fg"
        label="failed"
      />
      <CountBadge
        icon="⊘"
        value={blocked}
        tokenBg="--result-blocked-bg"
        tokenFg="--result-blocked-fg"
        label="blocked"
      />
      <CountBadge
        icon="⤼"
        value={skipped}
        tokenBg="--result-skipped-bg"
        tokenFg="--result-skipped-fg"
        label="skipped"
      />
      <CountBadge
        icon="◌"
        value={notRun}
        tokenBg="--result-not-run-bg"
        tokenFg="--result-not-run-fg"
        label="not run"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignee chip + popover
// ---------------------------------------------------------------------------

function AssigneeChip({
  userId,
  onRemove,
  canEdit,
}: {
  userId: string;
  onRemove: (id: string) => void;
  canEdit: boolean;
}) {
  // Display first 8 chars of UUID as a compact identifier.
  const short = userId.slice(0, 8);
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: "var(--bg-surface-2)",
        color: "var(--fg-default)",
        border: "1px solid var(--border-default)",
      }}
    >
      <span
        className="h-4 w-4 flex items-center justify-center rounded-full text-[10px] font-bold"
        aria-hidden="true"
        style={{ background: "var(--accent-soft)", color: "var(--accent-fg)" }}
      >
        {short[0]?.toUpperCase() ?? "?"}
      </span>
      {short}
      {canEdit && (
        <button
          type="button"
          onClick={() => onRemove(userId)}
          aria-label={`Remove assignee ${short}`}
          className="rounded-full opacity-60 hover:opacity-100 transition-opacity outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

function AssigneeRow({
  run,
  projectSlug,
}: {
  run: RunSummary;
  projectSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [newId, setNewId] = useState("");
  const updateRun = useUpdateRun(projectSlug, run.id);
  const canEdit = run.status === "open";

  const handleRemove = (userId: string) => {
    const next = run.assignee_user_ids.filter((id) => id !== userId);
    updateRun.mutate({ assignee_user_ids: next });
  };

  const handleAdd = () => {
    const trimmed = newId.trim();
    if (!trimmed) return;
    const next = [...run.assignee_user_ids, trimmed];
    updateRun.mutate({ assignee_user_ids: next });
    setNewId("");
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {run.assignee_user_ids.map((uid) => (
        <AssigneeChip
          key={uid}
          userId={uid}
          onRemove={handleRemove}
          canEdit={canEdit}
        />
      ))}
      {run.assignee_user_ids.length === 0 && (
        <span
          className="text-[11px]"
          style={{ color: "var(--fg-disabled)" }}
        >
          No assignees
        </span>
      )}
      {canEdit && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Add assignee"
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
                "transition-colors outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]",
              )}
              style={{
                background: "var(--bg-surface-2)",
                color: "var(--fg-muted)",
                border: "1px dashed var(--border-default)",
              }}
            >
              <UserPlus className="h-2.5 w-2.5" />
              Add
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64">
            <p
              className="text-xs font-semibold mb-2"
              style={{ color: "var(--fg-default)" }}
            >
              Add assignee by user ID
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAdd();
                  }
                }}
                placeholder="User ID (UUID)"
                className="flex-1 rounded-md px-2.5 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
                style={{
                  background: "var(--bg-surface-2)",
                  border: "1px solid var(--border-default)",
                  color: "var(--fg-default)",
                }}
                aria-label="User ID to add as assignee"
              />
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!newId.trim() || updateRun.isPending}
              >
                Add
              </Button>
            </div>
            {updateRun.isError && (
              <p
                className="mt-2 text-[11px]"
                style={{ color: "var(--feedback-error-fg)" }}
              >
                {updateRun.error instanceof Error
                  ? updateRun.error.message
                  : "Failed to update assignees"}
              </p>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Environment chip
// ---------------------------------------------------------------------------

function EnvironmentChip({
  envId,
  projectSlug,
}: {
  envId: string | null;
  projectSlug: string;
}) {
  const { data: envs } = useEnvironments(projectSlug);
  const env = envId ? envs?.find((e) => e.id === envId) : null;

  if (!envId || !env) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px]"
        style={{ color: "var(--fg-disabled)" }}
      >
        <Globe className="h-3 w-3" aria-hidden="true" />
        No environment
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: "var(--bg-surface-2)",
        color: "var(--fg-default)",
        border: "1px solid var(--border-default)",
      }}
    >
      <Globe className="h-2.5 w-2.5" aria-hidden="true" />
      {env.name}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Close dialog
// ---------------------------------------------------------------------------

interface CloseDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When true, pre-selects "aborted" (used by the Abort overflow item) */
  preSelectAbort?: boolean;
  run: RunSummary;
  projectSlug: string;
}

function CloseDialog({
  open,
  onOpenChange,
  preSelectAbort = false,
  run,
  projectSlug,
}: CloseDialogProps) {
  const [reason, setReason] = useState<"completed" | "aborted">(
    preSelectAbort ? "aborted" : "completed",
  );
  const [note, setNote] = useState("");
  const closeRun = useCloseRun(projectSlug, run.id);

  const handleSubmit = () => {
    closeRun.mutate(
      { reason, note: note.trim() || null },
      {
        onSuccess: () => {
          onOpenChange(false);
          setNote("");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close run</DialogTitle>
          <DialogDescription>
            Closing the run makes it immutable. Choose how it ended.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Reason */}
          <fieldset className="flex flex-col gap-2">
            <legend
              className="text-xs font-semibold mb-1"
              style={{ color: "var(--fg-default)" }}
            >
              Outcome
            </legend>
            {(["completed", "aborted"] as const).map((r) => (
              <label
                key={r}
                className="flex items-center gap-2 cursor-pointer text-sm"
                style={{ color: "var(--fg-default)" }}
              >
                <input
                  type="radio"
                  name="close-reason"
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="accent-[color:var(--accent-primary)]"
                />
                <span className="capitalize">{r}</span>
              </label>
            ))}
          </fieldset>

          {/* Note */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="close-note"
              className="text-xs font-semibold"
              style={{ color: "var(--fg-default)" }}
            >
              Note{" "}
              <span style={{ color: "var(--fg-muted)" }}>(optional)</span>
            </label>
            <textarea
              id="close-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Any final notes about this run…"
              className="w-full rounded-md px-3 py-2 text-sm resize-none outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
              style={{
                background: "var(--bg-surface-2)",
                border: "1px solid var(--border-default)",
                color: "var(--fg-default)",
              }}
            />
          </div>

          {closeRun.isError && (
            <p
              className="text-xs"
              style={{ color: "var(--feedback-error-fg)" }}
            >
              {closeRun.error instanceof Error
                ? closeRun.error.message
                : "Failed to close run"}
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={closeRun.isPending}
            variant={reason === "aborted" ? "destructive" : "primary"}
          >
            {closeRun.isPending
              ? "Closing…"
              : reason === "aborted"
                ? "Abort run"
                : "Complete run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit metadata dialog
// ---------------------------------------------------------------------------

interface EditMetadataDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  run: RunSummary;
  projectSlug: string;
}

function EditMetadataDialog({
  open,
  onOpenChange,
  run,
  projectSlug,
}: EditMetadataDialogProps) {
  const [title, setTitle] = useState(run.title);
  const { data: envs } = useEnvironments(projectSlug);
  const [envId, setEnvId] = useState(run.environment_id ?? "");
  const updateRun = useUpdateRun(projectSlug, run.id);

  const handleSave = () => {
    updateRun.mutate(
      {
        title: title.trim() || run.title,
        environment_id: envId || null,
      },
      {
        onSuccess: () => onOpenChange(false),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit run metadata</DialogTitle>
          <DialogDescription>
            Update the title and environment for this run.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="meta-title"
              className="text-xs font-semibold"
              style={{ color: "var(--fg-default)" }}
            >
              Title
            </label>
            <input
              id="meta-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-md px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
              style={{
                background: "var(--bg-surface-2)",
                border: "1px solid var(--border-default)",
                color: "var(--fg-default)",
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="meta-env"
              className="text-xs font-semibold"
              style={{ color: "var(--fg-default)" }}
            >
              Environment
            </label>
            <select
              id="meta-env"
              value={envId}
              onChange={(e) => setEnvId(e.target.value)}
              className="rounded-md px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
              style={{
                background: "var(--bg-surface-2)",
                border: "1px solid var(--border-default)",
                color: "var(--fg-default)",
              }}
            >
              <option value="">— None —</option>
              {envs?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>

          {updateRun.isError && (
            <p
              className="text-xs"
              style={{ color: "var(--feedback-error-fg)" }}
            >
              {updateRun.error instanceof Error
                ? updateRun.error.message
                : "Failed to update run"}
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" onClick={handleSave} disabled={updateRun.isPending}>
            {updateRun.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Overflow menu
// ---------------------------------------------------------------------------

interface OverflowMenuProps {
  run: RunSummary;
  projectSlug: string;
  onAbort: () => void;
  onEditMetadata: () => void;
  canReopen: boolean;
}

function OverflowMenu({
  run,
  projectSlug,
  onAbort,
  onEditMetadata,
  canReopen,
}: OverflowMenuProps) {
  const navigate = useNavigate();
  const rerun = useRerun(projectSlug, run.id);
  const reopen = useReopenRun(projectSlug, run.id);

  const handleRerunFailed = () => {
    rerun.mutate(
      { include_statuses: ["fail"] },
      {
        onSuccess: (newRun) => {
          navigate(`/p/${projectSlug}/runs/${newRun.id}`);
        },
      },
    );
  };

  const handleRerunAll = () => {
    rerun.mutate(
      {},
      {
        onSuccess: (newRun) => {
          navigate(`/p/${projectSlug}/runs/${newRun.id}`);
        },
      },
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="More actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Run actions</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={handleRerunFailed}
          disabled={rerun.isPending}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Rerun failed
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleRerunAll}
          disabled={rerun.isPending}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Rerun all
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onEditMetadata}>
          <Settings2 className="h-4 w-4" aria-hidden="true" />
          Edit metadata
        </DropdownMenuItem>
        {run.status === "open" && (
          <DropdownMenuItem
            onClick={onAbort}
            className="text-[color:var(--feedback-error-fg)] focus:text-[color:var(--feedback-error-fg)]"
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            Abort
          </DropdownMenuItem>
        )}
        {canReopen && run.status !== "open" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => reopen.mutate()}
              disabled={reopen.isPending}
            >
              <Unlock className="h-4 w-4" aria-hidden="true" />
              Reopen
            </DropdownMenuItem>
          </>
        )}
        {run.status !== "open" && !canReopen && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <Lock className="h-4 w-4" aria-hidden="true" />
              <span>Run closed</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Header skeleton
// ---------------------------------------------------------------------------

export function RunDetailHeaderSkeleton() {
  return (
    <div
      className="sticky top-0 z-10 flex flex-col gap-2 px-5 py-4 border-b"
      aria-busy="true"
      aria-label="Loading run header"
      style={{ background: "var(--bg-app)", borderColor: "var(--border-default)" }}
    >
      {/* Breadcrumb skeleton */}
      <div
        className="h-3 w-40 rounded animate-pulse"
        style={{ background: "var(--bg-surface-3)" }}
      />
      {/* Title row skeleton */}
      <div className="flex items-center gap-3">
        <div
          className="h-6 w-64 rounded animate-pulse"
          style={{ background: "var(--bg-surface-3)" }}
        />
        <div
          className="h-5 w-16 rounded-full animate-pulse"
          style={{ background: "var(--bg-surface-3)" }}
        />
      </div>
      {/* Counts strip skeleton */}
      <div className="flex gap-1.5">
        {[40, 36, 40, 38, 38].map((w, i) => (
          <div
            key={i}
            className="h-5 rounded-full animate-pulse"
            style={{ background: "var(--bg-surface-3)", width: `${w}px` }}
          />
        ))}
      </div>
      {/* Meta row skeleton */}
      <div className="flex gap-2">
        <div
          className="h-4 w-28 rounded animate-pulse"
          style={{ background: "var(--bg-surface-3)" }}
        />
        <div
          className="h-4 w-20 rounded animate-pulse"
          style={{ background: "var(--bg-surface-3)" }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function RunDetailHeader({ run }: RunDetailHeaderProps) {
  const { projectSlug = "" } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const [closeOpen, setCloseOpen] = useState(false);
  const [abortOpen, setAbortOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const canReopen = usePermission(projectSlug, "runs:reopen");
  const isOpen = run.status === "open";

  return (
    <>
      <header
        className="sticky top-0 z-10 flex flex-col gap-2 px-5 py-4"
        style={{
          background: "var(--bg-app)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        {/* Breadcrumb */}
        <AppBreadcrumb
          segments={[
            { label: "Runs", href: `/p/${projectSlug}/runs` },
            { label: run.title },
          ]}
        />

        {/* Title + status chip + primary actions */}
        <div className="flex items-start gap-3">
          <div className="flex flex-1 min-w-0 items-center gap-2.5 flex-wrap">
            <h1
              className="text-[15px] font-semibold tracking-tight leading-tight truncate"
              style={{ color: "var(--fg-default)" }}
            >
              {run.title}
            </h1>
            <RunStatusChip status={run.status} close_reason={run.close_reason} />
          </div>

          {/* Primary actions */}
          <div className="flex shrink-0 items-center gap-2">
            {isOpen && (
              <Button
                size="sm"
                onClick={() =>
                  navigate(`/p/${projectSlug}/runs/${run.id}/execute`)
                }
                aria-label="Execute this run"
              >
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                Execute
                <span aria-hidden="true"> →</span>
              </Button>
            )}
            {isOpen && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCloseOpen(true)}
              >
                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                Close
              </Button>
            )}
            <OverflowMenu
              run={run}
              projectSlug={projectSlug}
              onAbort={() => setAbortOpen(true)}
              onEditMetadata={() => setEditOpen(true)}
              canReopen={canReopen}
            />
          </div>
        </div>

        {/* Counts strip */}
        <CountsStrip run={run} />

        {/* Environment + assignees */}
        <div className="flex items-center gap-3 flex-wrap">
          <EnvironmentChip
            envId={run.environment_id}
            projectSlug={projectSlug}
          />
          <span
            aria-hidden="true"
            className="text-[11px]"
            style={{ color: "var(--border-default)" }}
          >
            ·
          </span>
          <AssigneeRow run={run} projectSlug={projectSlug} />
        </div>
      </header>

      {/* Close dialog (completed path) */}
      <CloseDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        run={run}
        projectSlug={projectSlug}
      />

      {/* Abort dialog (pre-selects aborted) */}
      <CloseDialog
        open={abortOpen}
        onOpenChange={setAbortOpen}
        preSelectAbort
        run={run}
        projectSlug={projectSlug}
      />

      {/* Edit metadata dialog */}
      <EditMetadataDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        run={run}
        projectSlug={projectSlug}
      />
    </>
  );
}
