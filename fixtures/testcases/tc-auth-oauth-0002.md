---
id: TC-AUTH-OAUTH-0002
title: User logs in via Google OAuth
summary: Verify the OAuth 2.0 PKCE flow with Google as the identity provider.
status: active
priority: high
type: functional
component: auth
subcomponent: oauth
owner: qa-auth-team
tags:
  - auth
  - oauth
  - google
  - regression
requirements:
  - REQ-AUTH-010
preconditions:
  - Google OAuth app credentials are configured in the test environment
  - A Google test account exists linked to the application
  - User is not logged in
steps:
  - number: 1
    action: Navigate to /login and click "Continue with Google"
    expected: Browser redirects to accounts.google.com with client_id and redirect_uri params
  - number: 2
    action: Sign in with the Google test account credentials
    expected: Google redirects back to the application callback URL with an auth code
  - number: 3
    action: Observe the application callback handling
    expected: Application exchanges code for tokens; user is redirected to dashboard
  - number: 4
    action: Inspect the session
    expected: User profile shows Google avatar and name; provider field shows "google"
automation:
  status: candidate
  framework: playwright
review:
  state: in_review
  reviewers:
    - qa-lead
    - security-reviewer
version: 1
environment_constraints:
  - staging
  - not-production
---

## Implementation Notes

OAuth flows require special handling in automation due to redirect chains.
The Playwright test should use mock OAuth server in CI; real Google only in staging.
