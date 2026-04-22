import type { ColumnDef } from "@tanstack/react-table";
import { EntityTable } from "@/components/shared/EntityTable";
import type { Density } from "@/components/shared/PageHeader";
import { RunStatusChip } from "./RunStatusChip";
import { RunProgressBar } from "./RunProgressBar";
import type { RunSummary } from "../hooks/runs";
import type { Environment } from "../hooks/environments";

/** Resolved environment name for display in the table */
export interface RunRow extends RunSummary {
  _envName?: string;
}

interface RunsTableProps {
  data: RunRow[];
  onRowClick: (run: RunRow) => void;
  selectedId?: string;
  density?: Density;
  /** Map of environment id → name, used to resolve the env column */
  environmentMap?: Record<string, string>;
}

/**
 * Relative time helper — no date-fns dependency.
 * Returns strings like "2 min ago", "3 hr ago", "5 days ago", "Jan 4".
 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  // Older — show short date
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function buildColumns(
  environmentMap: Record<string, string>,
): ColumnDef<RunRow>[] {
  return [
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
      id: "status",
      header: "Status",
      size: 112,
      meta: { headerClassName: "shrink-0", className: "shrink-0" },
      cell: ({ row }) => (
        <RunStatusChip
          status={row.original.status}
          close_reason={row.original.close_reason}
        />
      ),
    },
    {
      id: "environment",
      header: "Environment",
      accessorKey: "environment_id",
      size: 128,
      meta: { className: "shrink-0" },
      cell: ({ getValue }) => {
        const envId = getValue<string | null>();
        if (!envId) {
          return <span style={{ color: "var(--fg-disabled)" }}>—</span>;
        }
        const name = environmentMap[envId] ?? envId;
        return (
          <span
            className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium truncate max-w-[110px]"
            style={{
              background: "var(--bg-surface-2)",
              color: "var(--fg-muted)",
              border: "1px solid var(--border-subtle)",
            }}
            title={name}
          >
            {name}
          </span>
        );
      },
    },
    {
      id: "progress",
      header: "Progress",
      size: 180,
      meta: { className: "shrink-0" },
      cell: ({ row }) => (
        <RunProgressBar run={row.original} className="w-full" />
      ),
    },
    {
      id: "owner",
      header: "Owner",
      size: 120,
      meta: { className: "shrink-0" },
      cell: ({ row }) => {
        // Show first assignee user id, truncated — full user resolution is
        // out of scope for this table (no user directory hook yet in SP3.3).
        const uid = row.original.created_by_user_id;
        if (!uid) {
          return (
            <span
              className="inline-flex items-center gap-1 text-[11px]"
              style={{ color: "var(--fg-muted)" }}
            >
              {/* Bot/token indicator */}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <rect x="1" y="3" width="8" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                <path d="M3.5 3V2.5C3.5 1.67 4.17 1 5 1C5.83 1 6.5 1.67 6.5 2.5V3" stroke="currentColor" strokeWidth="1.2" />
                <circle cx="3.5" cy="5.5" r="0.75" fill="currentColor" />
                <circle cx="6.5" cy="5.5" r="0.75" fill="currentColor" />
              </svg>
              <span className="truncate max-w-[80px]" title="Automated">Automated</span>
            </span>
          );
        }
        // Truncate the UUID to 8 chars for display; hover shows full id
        const short = uid.slice(0, 8);
        return (
          <span
            className="font-mono text-[11px] truncate"
            style={{ color: "var(--fg-muted)" }}
            title={uid}
          >
            {short}…
          </span>
        );
      },
    },
    {
      id: "updated_at",
      header: "Updated",
      accessorKey: "updated_at",
      size: 110,
      meta: { className: "shrink-0" },
      cell: ({ getValue }) => {
        const v = getValue<string | undefined>();
        if (!v) return <span style={{ color: "var(--fg-disabled)" }}>—</span>;
        return (
          <span
            className="text-[12px] tabular-nums"
            style={{ color: "var(--fg-muted)" }}
            title={new Date(v).toLocaleString()}
          >
            {relativeTime(v)}
          </span>
        );
      },
    },
  ];
}

export function RunsTable({
  data,
  onRowClick,
  selectedId,
  density = "comfortable",
  environmentMap = {},
}: RunsTableProps) {
  const columns = buildColumns(environmentMap);

  return (
    <EntityTable<RunRow>
      data={data}
      columns={columns}
      onRowClick={onRowClick}
      selectedId={selectedId}
      density={density}
      getRowId={(row) => row.id}
      aria-label="Runs list"
      className="h-full"
    />
  );
}

/** Build a lookup map from an environments array for use with RunsTable */
export function buildEnvironmentMap(
  environments: Environment[],
): Record<string, string> {
  return Object.fromEntries(environments.map((e) => [e.id, e.name]));
}
