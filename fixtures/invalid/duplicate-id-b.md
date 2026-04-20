---
id: TC-PAYMENTS-DUPLICATE-0001
title: Second test case with duplicate ID (file B)
status: draft
priority: low
type: regression
component: payments
owner: qa-platform
steps:
  - number: 1
    action: Do something in file B
    expected: File B outcome
---

This fixture intentionally uses the same ID as `duplicate-id-a.md`.
The validator should detect the duplicate ID and report an error identifying
both files. Only one file can own a given ID in a project.
