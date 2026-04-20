---
title: Test case missing its ID field
status: active
priority: high
type: functional
component: payments
owner: qa-platform
steps:
  - number: 1
    action: Do something
    expected: Something happens
---

This fixture is intentionally invalid: the required `id` field is absent.
The validator should reject this with a missing required field error.
