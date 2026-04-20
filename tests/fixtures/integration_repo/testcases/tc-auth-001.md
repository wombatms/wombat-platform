---
id: TC-INT-AUTH-001
title: User logs in with valid email and password
summary: Verify that a registered user can successfully authenticate with correct credentials.
status: active
priority: high
type: functional
component: auth
owner: qa-team
tags:
  - auth
  - login
  - smoke
steps:
  - number: 1
    action: Navigate to /login
    expected: Login page loads
  - number: 2
    action: Enter valid credentials
    expected: Fields populated
  - number: 3
    action: Click Sign In
    expected: Dashboard loads
version: 1
---

Verify the standard login flow with valid email and password credentials.
