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
};
