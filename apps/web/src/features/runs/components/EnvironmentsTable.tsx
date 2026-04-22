import {
  useState,
  useRef,
  useEffect,
  type KeyboardEvent,
  type FormEvent,
} from "react";
import { Plus, Trash2, Globe, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeleteEnvironmentDialog } from "./DeleteEnvironmentDialog";
import {
  useEnvironments,
  useCreateEnvironment,
  useDeleteEnvironment,
  type Environment,
} from "../hooks/environments";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { cn } from "@/lib/utils";
import { isApiError } from "@/lib/api/errors";

/**
 * Formats an ISO-8601 datetime string to a human-readable relative or
 * absolute date, depending on recency.
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";

  const diffMs = Date.now() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Table skeleton
// ---------------------------------------------------------------------------

function TableSkeleton() {
  return (
    <div
      className="rounded-lg border overflow-hidden"
      aria-busy="true"
      aria-label="Loading environments"
      style={{ borderColor: "var(--border-default)" }}
    >
      {/* Header */}
      <div
        className="grid px-4 py-2.5"
        style={{
          gridTemplateColumns: "1fr 160px 48px",
          background: "var(--bg-surface-2)",
          borderBottom: "1px solid var(--border-default)",
        }}
      >
        {["Name", "Created", ""].map((label, i) => (
          <div
            key={i}
            className="h-3 w-20 rounded animate-pulse"
            style={{ background: "var(--bg-surface-3)" }}
            aria-hidden="true"
          />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="grid px-4 py-3 border-b last:border-0"
          style={{
            gridTemplateColumns: "1fr 160px 48px",
            borderColor: "var(--border-default)",
            background: "var(--bg-surface-1)",
          }}
        >
          <div className="h-3.5 w-28 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          <div className="h-3 w-20 rounded animate-pulse" style={{ background: "var(--bg-surface-3)" }} />
          <div />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline add row
// ---------------------------------------------------------------------------

interface AddRowProps {
  projectSlug: string;
  onDone: () => void;
}

function AddRow({ projectSlug, onDone }: AddRowProps) {
  const [name, setName] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { mutate: createEnv, isPending } = useCreateEnvironment(projectSlug);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setFieldError("Name is required.");
      return;
    }
    setFieldError(null);
    createEnv(
      { name: trimmed },
      {
        onSuccess: () => {
          setName("");
          onDone();
        },
        onError: (err) => {
          if (isApiError(err) && err.code === "environment_already_exists") {
            setFieldError("An environment with that name already exists.");
          } else {
            setFieldError(
              err instanceof Error ? err.message : "Failed to create environment.",
            );
          }
        },
      },
    );
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      onDone();
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  return (
    <tr
      style={{
        background: "var(--accent-soft)",
        borderBottom: "1px solid var(--border-default)",
      }}
    >
      <td className="px-4 py-2.5" colSpan={2}>
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div className="flex flex-col gap-1 flex-1 min-w-0">
            <Input
              ref={inputRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldError) setFieldError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Environment name (e.g. Staging)"
              aria-label="New environment name"
              aria-describedby={fieldError ? "add-env-error" : undefined}
              aria-invalid={fieldError !== null}
              maxLength={100}
              disabled={isPending}
              className="h-8 text-xs"
            />
            {fieldError && (
              <p
                id="add-env-error"
                role="alert"
                className="text-[11px]"
                style={{ color: "var(--feedback-error-fg)" }}
              >
                {fieldError}
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={isPending || !name.trim()}
            aria-label="Save environment"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
              "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
            style={{
              background: "var(--accent-primary)",
              color: "var(--fg-inverse)",
            }}
          >
            <CheckCircle className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onDone}
            disabled={isPending}
            aria-label="Cancel add environment"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
              "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
            style={{
              background: "transparent",
              color: "var(--fg-muted)",
              border: "1px solid var(--border-default)",
            }}
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      </td>
      {/* spacer for delete column */}
      <td />
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface EnvironmentsTableProps {
  projectSlug: string;
  /** When false, add/delete controls are hidden */
  isAdmin: boolean;
}

/**
 * EnvironmentsTable — displays project environments in a bordered table with:
 * - Skeleton loading state
 * - Empty state with inline add prompt
 * - Error state with retry
 * - Inline add row (admin-only, `Enter` saves / `Esc` cancels)
 * - Delete button per row (admin-only) → opens DeleteEnvironmentDialog
 *
 * Note: the Environment type has no `run_count` field in the API schema.
 * Run-count tracking is deferred to a future follow-up.
 */
export function EnvironmentsTable({ projectSlug, isAdmin }: EnvironmentsTableProps) {
  const [showAddRow, setShowAddRow] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Environment | null>(null);

  const { data: environments, isLoading, isError, error, refetch } = useEnvironments(projectSlug);
  const { mutate: deleteEnv, isPending: isDeleting } = useDeleteEnvironment(projectSlug);

  const handleDeleteConfirm = (env: Environment) => {
    deleteEnv(env.id, {
      onSuccess: () => setPendingDelete(null),
      onError: () => setPendingDelete(null),
    });
  };

  // ---- Loading state ----
  if (isLoading) {
    return <TableSkeleton />;
  }

  // ---- Error state ----
  if (isError) {
    return (
      <ErrorState
        error={error}
        onRetry={() => void refetch()}
        title="Could not load environments"
      />
    );
  }

  const envList = environments ?? [];

  // ---- Empty state ----
  if (envList.length === 0 && !showAddRow) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={<Globe className="h-4 w-4" aria-hidden="true" />}
          title="No environments yet"
          description={
            isAdmin
              ? "Create a named environment (e.g. Staging, Production) to tag your test runs."
              : "No environments have been created for this project."
          }
          action={
            isAdmin ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowAddRow(true)}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add environment
              </Button>
            ) : undefined
          }
        />
        {showAddRow && (
          /* shouldn't reach here given the guard above, but safety net */
          <table className="w-full border-collapse">
            <tbody>
              <AddRow projectSlug={projectSlug} onDone={() => setShowAddRow(false)} />
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        className="rounded-lg border overflow-hidden"
        style={{ borderColor: "var(--border-default)" }}
      >
        <table className="w-full border-collapse text-sm" aria-label="Project environments">
          <thead>
            <tr
              style={{
                background: "var(--bg-surface-2)",
                borderBottom: "1px solid var(--border-default)",
              }}
            >
              <th
                className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--fg-muted)" }}
              >
                Name
              </th>
              <th
                className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider w-44"
                style={{ color: "var(--fg-muted)" }}
              >
                Created
              </th>
              {isAdmin && (
                <th
                  className="px-4 py-2.5 w-12"
                  aria-label="Actions"
                />
              )}
            </tr>
          </thead>
          <tbody>
            {/* Inline add row — always first when visible */}
            {showAddRow && (
              <AddRow projectSlug={projectSlug} onDone={() => setShowAddRow(false)} />
            )}

            {envList.map((env) => (
              <tr
                key={env.id}
                className="group"
                style={{
                  background: "var(--bg-surface-1)",
                  borderBottom: "1px solid var(--border-default)",
                }}
              >
                {/* Name */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Globe
                      className="h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                      style={{ color: "var(--fg-disabled)" }}
                    />
                    <span
                      className="text-[13px] font-medium font-mono"
                      style={{ color: "var(--fg-default)" }}
                    >
                      {env.name}
                    </span>
                  </div>
                </td>

                {/* Created date */}
                <td
                  className="px-4 py-3 text-[12px]"
                  style={{ color: "var(--fg-muted)" }}
                >
                  <time dateTime={env.created_at} title={env.created_at}>
                    {formatDate(env.created_at)}
                  </time>
                </td>

                {/* Delete (admin-only) */}
                {isAdmin && (
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      aria-label={`Delete environment ${env.name}`}
                      onClick={() => setPendingDelete(env)}
                      className={cn(
                        "inline-flex h-7 w-7 items-center justify-center rounded-md",
                        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                        "transition-opacity duration-120",
                        "outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]",
                      )}
                      style={{
                        color: "var(--feedback-error-fg)",
                        background: "transparent",
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </td>
                )}
              </tr>
            ))}

            {/* Placeholder row when list is empty but addRow is shown */}
            {envList.length === 0 && !showAddRow && (
              <tr>
                <td
                  colSpan={isAdmin ? 3 : 2}
                  className="px-4 py-6 text-center text-sm"
                  style={{ color: "var(--fg-muted)" }}
                >
                  No environments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Admin: add button below the table */}
      {isAdmin && !showAddRow && (
        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAddRow(true)}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add environment
          </Button>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <DeleteEnvironmentDialog
        environment={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleDeleteConfirm}
        isPending={isDeleting}
      />
    </>
  );
}
