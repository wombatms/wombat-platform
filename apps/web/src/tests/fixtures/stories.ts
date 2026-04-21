export const FIXTURE_STORY_1 = {
  id: "eeee0000-0000-0000-0000-000000000001",
  wombat_id: "ST-AUTH-001",
  title: "Authentication flow",
  kind: "story",
  tags: ["auth"],
  body: "## Background\nUsers need to authenticate.\n\n## Scenarios\n- Happy path login\n- Failed login",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
};

export const FIXTURE_STORY_2 = {
  id: "eeee0000-0000-0000-0000-000000000002",
  wombat_id: "ST-SEARCH-001",
  title: "Global search feature",
  kind: "story",
  tags: ["search"],
  body: "## Background\nUsers search across content.\n\n## Scenarios\n- Keyword search\n- Semantic search",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
};

export const FIXTURE_STORIES_LIST = {
  data: [FIXTURE_STORY_1, FIXTURE_STORY_2],
  total: 2,
  limit: 50,
  offset: 0,
};
