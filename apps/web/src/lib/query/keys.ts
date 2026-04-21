export interface ProposalListFilters {
  status?: string;
  kind?: string;
  author_user_id?: string;
  author_kind?: string;
  content_id?: string;
  cursor?: string;
  limit?: number;
}

export const keys = {
  auth: {
    me: ["auth", "me"] as const,
  },
  projects: {
    list: ["projects"] as const,
  },
  project: (slug: string) => ["project", slug] as const,
  testcase: {
    list: (slug: string, filters: Record<string, unknown>) =>
      ["project", slug, "testcases", filters] as const,
    detail: (slug: string, wombatId: string) =>
      ["project", slug, "testcases", "detail", wombatId] as const,
  },
  sharedStep: {
    list: (slug: string, filters: Record<string, unknown>) =>
      ["project", slug, "shared-steps", filters] as const,
    detail: (slug: string, wombatId: string) =>
      ["project", slug, "shared-steps", "detail", wombatId] as const,
  },
  story: {
    list: (slug: string, filters: Record<string, unknown>) =>
      ["project", slug, "stories", filters] as const,
    detail: (slug: string, wombatId: string) =>
      ["project", slug, "stories", "detail", wombatId] as const,
  },
  search: (slug: string, body: Record<string, unknown>) =>
    ["project", slug, "search", body] as const,
  tokens: ["auth", "tokens"] as const,
  proposal: {
    /** Matches the full list subtree — used by removeQueries when switching projects. */
    all: (slug: string) => ["project", slug, "proposals"] as const,
    list: (slug: string, filters: ProposalListFilters) =>
      ["project", slug, "proposals", "list", filters] as const,
    detail: (slug: string, id: string) =>
      ["project", slug, "proposals", "detail", id] as const,
    /** Inbox badge count — drives nav count with 30 s stale time. */
    inboxBadge: (slug: string) =>
      ["project", slug, "proposals", "inbox-badge"] as const,
  },
};
