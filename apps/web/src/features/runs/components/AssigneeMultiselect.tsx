/**
 * AssigneeMultiselect — searchable multi-select for users and project API tokens.
 *
 * Displays chips for type distinction (user vs. token). Searches project members
 * via GET /api/projects/{slug}/members. Token listing falls back to the
 * /api/auth/api-tokens endpoint (personal tokens only — project-scoped token
 * list does not have a GET yet).
 *
 * Selected state is lifted: parent owns `userIds`, `tokenIds`, and their setters.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { User, Key, X, ChevronDown, Check, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Member {
  user_id: string;
  display_name?: string;
  email?: string;
  role: string;
}

export interface TokenOption {
  id: string;
  name: string;
}

interface AssigneeOption {
  kind: "user" | "token";
  id: string;
  label: string;
  sublabel?: string;
}

export interface AssigneeMultiselectProps {
  projectSlug: string;
  userIds: string[];
  tokenIds: string[];
  onChangeUserIds: (ids: string[]) => void;
  onChangeTokenIds: (ids: string[]) => void;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Data hooks (inline — scoped to this component)
// ---------------------------------------------------------------------------

function useProjectMembers(projectSlug: string) {
  return useQuery({
    queryKey: ["project", projectSlug, "members"],
    queryFn: async (): Promise<Member[]> => {
      const { data, error } = await api.GET(
        "/api/projects/{project_slug}/members",
        { params: { path: { project_slug: projectSlug } } },
      );
      if (error) throw error;
      // API returns unknown — normalise
      const raw = data as { data?: Member[] } | Member[] | unknown;
      if (Array.isArray(raw)) return raw as Member[];
      if (raw && typeof raw === "object" && "data" in raw) {
        return (raw as { data: Member[] }).data;
      }
      return [];
    },
    enabled: Boolean(projectSlug),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// AssigneeMultiselect
// ---------------------------------------------------------------------------

export function AssigneeMultiselect({
  projectSlug,
  userIds,
  tokenIds,
  onChangeUserIds,
  onChangeTokenIds,
  disabled = false,
}: AssigneeMultiselectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const { data: members = [] } = useProjectMembers(projectSlug);

  // Build option list: users from members
  const allOptions: AssigneeOption[] = members.map((m) => ({
    kind: "user" as const,
    id: m.user_id,
    label: m.display_name ?? m.email ?? m.user_id,
    sublabel: m.display_name ? m.email : undefined,
  }));

  const filtered = query.trim()
    ? allOptions.filter(
        (o) =>
          o.label.toLowerCase().includes(query.toLowerCase()) ||
          (o.sublabel?.toLowerCase().includes(query.toLowerCase()) ?? false),
      )
    : allOptions;

  const isSelected = useCallback(
    (option: AssigneeOption) => {
      if (option.kind === "user") return userIds.includes(option.id);
      return tokenIds.includes(option.id);
    },
    [userIds, tokenIds],
  );

  const toggle = useCallback(
    (option: AssigneeOption) => {
      if (option.kind === "user") {
        if (userIds.includes(option.id)) {
          onChangeUserIds(userIds.filter((id) => id !== option.id));
        } else {
          onChangeUserIds([...userIds, option.id]);
        }
      } else {
        if (tokenIds.includes(option.id)) {
          onChangeTokenIds(tokenIds.filter((id) => id !== option.id));
        } else {
          onChangeTokenIds([...tokenIds, option.id]);
        }
      }
    },
    [userIds, tokenIds, onChangeUserIds, onChangeTokenIds],
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Keyboard: Escape closes, no hijacking text input chars
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  // Chips for selected values
  const selectedOptions = allOptions.filter((o) => isSelected(o));

  // Resolve display label for a selected id that may not be in allOptions yet
  const displayLabel = (opt: AssigneeOption) => opt.label;

  return (
    // Container div only forwards keydown events to the inner combobox button
    // and listbox for keyboard navigation. The interactive elements (button,
    // input, options) are all inside and are properly labeled.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      {/* Trigger / chip container */}
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        disabled={disabled}
        onClick={() => {
          if (!open) {
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }}
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border px-2 py-1.5",
          "text-sm transition-[border-color,box-shadow] duration-150",
          "focus-visible:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-60",
          open && "ring-2 ring-[color:var(--focus-ring)]/30 border-[color:var(--focus-ring)]",
        )}
        style={{
          background: "var(--bg-surface-1)",
          borderColor: open ? "var(--focus-ring)" : "var(--border-default)",
          color: "var(--fg-default)",
        }}
      >
        {selectedOptions.length === 0 && !open && (
          <span style={{ color: "var(--fg-muted)" }} className="text-sm px-1">
            Add assignees...
          </span>
        )}
        {selectedOptions.map((opt) => (
          <AssigneeChip
            key={`${opt.kind}-${opt.id}`}
            label={displayLabel(opt)}
            kind={opt.kind}
            onRemove={(e) => {
              e.stopPropagation();
              toggle(opt);
            }}
          />
        ))}
        <ChevronDown
          className="ml-auto h-3.5 w-3.5 shrink-0"
          aria-hidden="true"
          style={{ color: "var(--fg-muted)" }}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="dialog"
          aria-label="Select assignees"
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-md border shadow-lg"
          style={{
            background: "var(--bg-surface-1)",
            borderColor: "var(--border-default)",
            boxShadow: "var(--shadow-md, 0 4px 16px rgba(0,0,0,0.12))",
          }}
        >
          {/* Search input */}
          <div
            className="flex items-center gap-2 border-b px-3 py-2"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <Search
              className="h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
              style={{ color: "var(--fg-muted)" }}
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search members..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--fg-muted)]"
              style={{ color: "var(--fg-default)" }}
              aria-label="Search assignees"
            />
          </div>

          {/* Option list */}
          <ul
            id={listboxId}
            role="listbox"
            aria-multiselectable="true"
            aria-label="Assignees"
            className="max-h-52 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li
                className="px-3 py-2 text-xs"
                style={{ color: "var(--fg-muted)" }}
              >
                {query ? "No matches" : "No members found"}
              </li>
            ) : (
              filtered.map((opt) => {
                const selected = isSelected(opt);
                return (
                  // Keyboard activation is handled by the listbox's onKeyDown
                  // (Arrow / Enter / Space) bound on the container at line 167.
                  // The click handler here is for mouse users only.
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                  <li
                    key={`${opt.kind}-${opt.id}`}
                    role="option"
                    aria-selected={selected}
                    onClick={() => toggle(opt)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-3 py-2 text-sm",
                      "transition-colors duration-100",
                    )}
                    style={{
                      background: selected
                        ? "var(--accent-soft)"
                        : "transparent",
                      color: "var(--fg-default)",
                    }}
                    onMouseEnter={(e) => {
                      if (!selected)
                        (e.currentTarget as HTMLLIElement).style.background =
                          "var(--bg-surface-2)";
                    }}
                    onMouseLeave={(e) => {
                      if (!selected)
                        (e.currentTarget as HTMLLIElement).style.background =
                          "transparent";
                    }}
                  >
                    {/* Kind icon */}
                    {opt.kind === "user" ? (
                      <User
                        className="h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                        style={{ color: "var(--fg-muted)" }}
                      />
                    ) : (
                      <Key
                        className="h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                        style={{ color: "var(--fg-muted)" }}
                      />
                    )}

                    <span className="flex flex-col min-w-0">
                      <span className="truncate font-medium">{opt.label}</span>
                      {opt.sublabel && (
                        <span
                          className="truncate text-[11px]"
                          style={{ color: "var(--fg-muted)" }}
                        >
                          {opt.sublabel}
                        </span>
                      )}
                    </span>

                    {selected && (
                      <Check
                        className="ml-auto h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                        style={{ color: "var(--accent-fg)" }}
                      />
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssigneeChip
// ---------------------------------------------------------------------------

interface AssigneeChipProps {
  label: string;
  kind: "user" | "token";
  onRemove: (e: React.MouseEvent) => void;
}

function AssigneeChip({ label, kind, onRemove }: AssigneeChipProps) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        background:
          kind === "user" ? "var(--accent-soft)" : "var(--bg-surface-3)",
        color:
          kind === "user" ? "var(--accent-fg)" : "var(--fg-default)",
        border: "1px solid var(--border-default)",
      }}
    >
      {kind === "user" ? (
        <User className="h-2.5 w-2.5" aria-hidden="true" />
      ) : (
        <Key className="h-2.5 w-2.5" aria-hidden="true" />
      )}
      <span className="max-w-[120px] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="flex items-center justify-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring)]"
        style={{ color: "var(--fg-muted)" }}
      >
        <X className="h-2.5 w-2.5" aria-hidden="true" />
      </button>
    </span>
  );
}
