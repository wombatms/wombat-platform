---
id: SS-INT-LOGIN
title: Standard integration login steps
owner: qa-team
tags:
  - auth
variables:
  - email
  - password
steps:
  - number: 1
    action: Navigate to /login
    expected: Login page loads
  - number: 2
    action: Enter {email} in email field
    expected: Field populated
  - number: 3
    action: Enter {password} in password field
    expected: Field populated
  - number: 4
    action: Click Sign In
    expected: Authenticated
version: 1
---

Reusable shared login steps for integration tests.
