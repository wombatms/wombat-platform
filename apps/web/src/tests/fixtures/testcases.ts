export const FIXTURE_TESTCASE_1 = {
  id: "cccc0000-0000-0000-0000-000000000001",
  wombat_id: "TC-LOGIN-001",
  title: "User can log in with valid credentials",
  kind: "testcase",
  component: "auth",
  priority: "high",
  tags: ["smoke", "login"],
  automation: "automated",
  body: "## Steps\n1. Navigate to /login\n2. Enter valid credentials\n3. Submit\n\n## Expected\nUser is redirected to /projects.",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
};

export const FIXTURE_TESTCASE_2 = {
  id: "cccc0000-0000-0000-0000-000000000002",
  wombat_id: "TC-LOGIN-002",
  title: "User sees error on invalid password",
  kind: "testcase",
  component: "auth",
  priority: "med",
  tags: ["login"],
  automation: "manual",
  body: "## Steps\n1. Navigate to /login\n2. Enter wrong password\n\n## Expected\nError message displayed.",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
};

export const FIXTURE_TESTCASES_LIST = {
  data: [FIXTURE_TESTCASE_1, FIXTURE_TESTCASE_2],
  total: 2,
  limit: 50,
  offset: 0,
};
