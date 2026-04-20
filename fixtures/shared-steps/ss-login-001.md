---
id: SS-LOGIN-001
title: Standard user login via email and password
owner: qa-auth-team
tags:
  - auth
  - login
variables:
  - email
  - password
  - expected_redirect
steps:
  - number: 1
    action: Navigate to /login
    expected: Login page loads with email and password fields
  - number: 2
    action: Enter {email} in the email field
    expected: Email field displays the entered value
  - number: 3
    action: Enter {password} in the password field
    expected: Password field shows masked characters
  - number: 4
    action: Click "Sign In"
    expected: User is authenticated and redirected to {expected_redirect}
version: 2
---

## Usage

Reference this shared step in test cases that require a standard login before
beginning the primary test flow. Supply variables:

- `email` — the account email address (e.g. `test@example.com`)
- `password` — the account password
- `expected_redirect` — where the user lands after login (e.g. `/dashboard`)

## Variable Defaults

When no variables are supplied, test suites may use the default QA test account:
`qa-default@example.com` / `TestPass123!` → `/dashboard`.
