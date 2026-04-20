---
id: TC-AUTH-LOGIN-0001
title: User logs in with valid email and password
summary: Verify that a registered user can successfully authenticate with correct credentials.
status: active
priority: critical
type: functional
component: auth
subcomponent: login
owner: qa-auth-team
tags:
  - auth
  - login
  - smoke
  - critical-path
requirements:
  - REQ-AUTH-001
  - REQ-AUTH-002
preconditions:
  - A registered user account exists with email test@example.com
  - The user is not currently logged in
shared_steps:
  - SS-LOGIN-001
steps:
  - number: 1
    action: Navigate to /login
    expected: Login page loads with email and password fields visible
  - number: 2
    action: Enter "test@example.com" in the email field
    expected: Email field shows entered value
  - number: 3
    action: Enter "ValidPass123!" in the password field
    expected: Password field shows masked characters
  - number: 4
    action: Click the "Sign In" button
    expected: User is redirected to the dashboard; welcome message shows "Hello, Test User"
  - number: 5
    action: Check the browser's session cookie
    expected: A secure, httpOnly session cookie is set for the domain
automation:
  status: automated
  framework: playwright
  source: tests/e2e/auth/login.spec.ts
review:
  state: approved
  reviewers:
    - qa-lead
    - security-reviewer
version: 1
---

## Security Notes

This test verifies session cookie attributes (secure, httpOnly). Any change
to cookie configuration must be reflected here.
