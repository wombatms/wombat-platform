---
id: TICKET-PAYMENTS-0001
title: Test case with wrong ID prefix
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

This fixture is intentionally invalid: the `id` uses prefix `TICKET-` which is
not one of the allowed prefixes (TC, SS, PLAN, STORY, SUITE).
