---
id: TC-COMPONENT-SMOKE-XXXX
title: "{{FEATURE}} is operational (smoke check)"
summary: "Quick smoke check: verify {{FEATURE}} loads and responds without errors."
status: draft
priority: critical
type: smoke
component: "{{COMPONENT}}"
subcomponent: "{{SUBCOMPONENT}}"
owner: "{{OWNER}}"
tags:
  - smoke
  - critical-path
requirements:
  - "{{REQ_ID}}"
preconditions:
  - "Environment is deployed and accessible"
  - "{{PRECONDITION}}"
steps:
  - number: 1
    action: "Navigate to {{URL_OR_ENTRY_POINT}}"
    expected: "{{FEATURE}} loads without errors within 3 seconds"
  - number: 2
    action: "Perform the primary action: {{PRIMARY_ACTION}}"
    expected: "System responds with {{SUCCESS_INDICATOR}} — no 5xx errors"
  - number: 3
    action: "Check the browser console or server logs"
    expected: "No critical errors or unhandled exceptions in logs"
automation:
  status: automated
review:
  state: draft
  reviewers: []
version: 1
---

## Purpose

Smoke tests run first in every deployment pipeline. They are intentionally
minimal — one happy path only, no edge cases. If this test fails, the release
is blocked until resolved.

**Run time target:** < 60 seconds
**Run frequency:** Every deployment to any environment

## Critical Path

This test is part of the critical path for `{{COMPONENT}}`. Failures here
block the `{{PIPELINE_STAGE}}` pipeline stage.

## Notes

<!-- Keep smoke tests lean. If you're adding edge cases, use the functional or regression template instead. -->
