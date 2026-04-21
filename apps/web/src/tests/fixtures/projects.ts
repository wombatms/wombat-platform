export const FIXTURE_PROJECT_ALPHA = {
  id: "bbbb0000-0000-0000-0000-000000000001",
  slug: "alpha",
  name: "Alpha Project",
  org: "Acme Corp",
  default_owner: "alice",
  taxonomy_components: ["auth", "billing", "search"],
  taxonomy_environments: ["staging", "production"],
  role: "admin",
};

export const FIXTURE_PROJECT_BETA = {
  id: "bbbb0000-0000-0000-0000-000000000002",
  slug: "beta",
  name: "Beta Project",
  org: null,
  default_owner: null,
  taxonomy_components: [],
  taxonomy_environments: [],
  role: "viewer",
};

export const FIXTURE_PROJECTS_LIST = [FIXTURE_PROJECT_ALPHA, FIXTURE_PROJECT_BETA];
