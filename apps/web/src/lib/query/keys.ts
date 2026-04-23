export interface ProposalListFilters {
  status?: string;
  kind?: string;
  author_user_id?: string;
  author_kind?: string;
  content_id?: string;
  cursor?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// SP3.4 — Plans, Suites, Dashboards, Content-Resolve
//
// Design invariant: detail key is a prefix of resolve/startRun sub-resource
// keys so a single removeQueries({ queryKey: planKeys.detail(slug, wid) })
// clears the plan detail AND its resolved case list AND its start-run draft.
// ---------------------------------------------------------------------------

export const planKeys = {
  /** Matches all plans for a project. */
  all: (slug: string) => ["plans", slug] as const,
  /** 3-element prefix shared by resolve + startRun below. */
  detail: (slug: string, wid: string) => ["plans", slug, wid] as const,
  /** Extends detail — cached resolved case set for a saved plan. */
  resolve: (slug: string, wid: string) => ["plans", slug, wid, "resolve"] as const,
  /** Extends detail — pre-filled run-draft payload. */
  startRun: (slug: string, wid: string) => ["plans", slug, wid, "start-run"] as const,
};

export const suiteKeys = {
  /** Matches all suites for a project. */
  all: (slug: string) => ["suites", slug] as const,
  /** Flat list with parent_wombat_id; client builds the tree. */
  tree: (slug: string) => ["suites", slug, "tree"] as const,
  /** 3-element prefix shared by resolve below. */
  detail: (slug: string, wid: string) => ["suites", slug, wid] as const,
  /** Extends detail — effective case set for the suite subtree. */
  resolve: (slug: string, wid: string) => ["suites", slug, wid, "resolve"] as const,
};

export const dashboardKeys = {
  /** Static widget metadata for a project — drives the frontend registry. */
  meta: (slug: string) => ["dashboards", slug, "meta"] as const,
  /**
   * Per-widget cache entry.  `filters` is included in the key so changing any
   * filter produces a new cache entry (back-forward nav stays populated).
   * `w` = widget slug, `scope` = "project"|"plan", `sid` = scope_id.
   */
  widget: (slug: string, w: string, scope: string, sid: string, filters: object) =>
    ["dashboards", slug, w, scope, sid, filters] as const,
};

export const resolveKeys = {
  /**
   * Key for the debounced draft-preview hook.  `hash` is a stable hash of the
   * serialised body so rapid edits coalesce rather than evict.
   */
  draft: (slug: string, kind: string, hash: string) =>
    ["content-resolve", slug, kind, hash] as const,
};

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
