---
id: TC-PAYMENTS-DUPLICATE-0001
title: First test case with duplicate ID (file A)
status: active
priority: medium
type: functional
component: payments
owner: qa-platform
steps:
  - number: 1
    action: Do something in file A
    expected: File A outcome
---

This fixture intentionally uses the same ID as `duplicate-id-b.md`.
The validator should detect the duplicate ID and report an error identifying
both files. Only one file can own a given ID in a project.
