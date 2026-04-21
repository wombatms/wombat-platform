import type { ColumnDef } from "@tanstack/react-table";
import type { SharedStep } from "./useSharedStepList";

export const sharedStepColumns: ColumnDef<SharedStep>[] = [
  {
    id: "wombat_id",
    header: "ID",
    accessorKey: "wombat_id",
    size: 140,
    cell: ({ getValue }) => (
      <span
        className="font-mono text-[12px] font-medium"
        style={{ color: "var(--feedback-info-fg)" }}
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
        className="truncate text-[13px]"
        style={{ color: "var(--fg-default)" }}
      >
        {getValue<string>()}
      </span>
    ),
  },
  {
    id: "tags",
    header: "Tags",
    accessorKey: "tags",
    size: 200,
    cell: ({ getValue }) => {
      const tags = getValue<string[] | undefined>();
      if (!tags || tags.length === 0)
        return <span style={{ color: "var(--fg-disabled)" }}>—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                background: "var(--bg-surface-2)",
                color: "var(--fg-muted)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              {tag}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="text-[10px]" style={{ color: "var(--fg-disabled)" }}>
              +{tags.length - 3}
            </span>
          )}
        </div>
      );
    },
  },
  {
    id: "updated_at",
    header: "Updated",
    accessorKey: "updated_at",
    size: 120,
    cell: ({ getValue }) => {
      const v = getValue<string | undefined>();
      if (!v) return <span style={{ color: "var(--fg-disabled)" }}>—</span>;
      return (
        <span
          className="text-[12px] tabular-nums"
          style={{ color: "var(--fg-muted)" }}
        >
          {new Date(v).toLocaleDateString()}
        </span>
      );
    },
  },
];
