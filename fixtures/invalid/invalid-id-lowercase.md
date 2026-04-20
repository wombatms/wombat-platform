---
id: tc-payments-refund-0099
title: Test case with lowercase ID (invalid format)
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

This fixture is intentionally invalid: the `id` field uses lowercase letters
which violates the WombatID pattern `^(TC|SS|PLAN|STORY|SUITE)-[A-Z0-9][-A-Z0-9]*$`.
The validator should reject this with an ID format error.
