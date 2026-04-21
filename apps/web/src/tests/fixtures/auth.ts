export const FIXTURE_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "alice@example.com",
  display_name: "Alice",
  is_active: true,
  created_at: "2024-01-01T00:00:00Z",
};

export const FIXTURE_USER_2 = {
  id: "00000000-0000-0000-0000-000000000002",
  email: "bob@example.com",
  display_name: "Bob",
  is_active: true,
  created_at: "2024-01-02T00:00:00Z",
};

export const FIXTURE_TOKEN_RESPONSE = {
  access_token: "test-access-token.payload.sig",
  refresh_token: "test-refresh-token.payload.sig",
  token_type: "bearer",
};

export const FIXTURE_REFRESHED_TOKEN_RESPONSE = {
  access_token: "refreshed-access-token.payload.sig",
  refresh_token: "refreshed-refresh-token.payload.sig",
  token_type: "bearer",
};

export const FIXTURE_API_TOKEN = {
  id: "aaaa0000-0000-0000-0000-000000000001",
  name: "CI Token",
  scopes: ["read"],
  expires_at: null,
  created_at: "2024-01-01T00:00:00Z",
};

export const FIXTURE_API_TOKEN_LIST = [FIXTURE_API_TOKEN];

export const FIXTURE_CREATE_API_TOKEN_RESPONSE = {
  ...FIXTURE_API_TOKEN,
  raw_token: "wombat_test_raw_secret_token_value",
};

export const KNOWN_EMAIL = "alice@example.com";
export const KNOWN_PASSWORD = "correct-password";
