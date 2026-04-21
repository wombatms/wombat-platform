export const FIXTURE_SHARED_STEP_1 = {
  id: "dddd0000-0000-0000-0000-000000000001",
  wombat_id: "SS-NAV-001",
  title: "Navigate to login page",
  kind: "shared_step",
  tags: ["navigation"],
  body: "1. Open browser\n2. Go to `{base_url}/login`",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
};

export const FIXTURE_SHARED_STEP_2 = {
  id: "dddd0000-0000-0000-0000-000000000002",
  wombat_id: "SS-AUTH-001",
  title: "Submit login form",
  kind: "shared_step",
  tags: ["auth"],
  body: "1. Fill in email\n2. Fill in password\n3. Click Submit",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
};

export const FIXTURE_SHARED_STEPS_LIST = {
  data: [FIXTURE_SHARED_STEP_1, FIXTURE_SHARED_STEP_2],
  total: 2,
  limit: 50,
  offset: 0,
};
