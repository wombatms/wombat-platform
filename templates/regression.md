---
id: TC-COMPONENT-REGRESSION-XXXX
title: "{{FEATURE}} continues to work after {{CHANGE_DESCRIPTION}}"
summary: "Regression check: verify {{FEATURE}} is unbroken following {{CHANGE_DESCRIPTION}}."
status: draft
priority: high
type: regression
component: "{{COMPONENT}}"
subcomponent: "{{SUBCOMPONENT}}"
owner: "{{OWNER}}"
tags:
  - regression
requirements:
  - "{{REQ_ID}}"
preconditions:
  - "Environment is reset to baseline state"
  - "{{PRECONDITION}}"
steps:
  - number: 1
    action: "{{SETUP_ACTION}}"
    expected: "System is in the expected pre-condition state"
  - number: 2
    action: "{{PRIMARY_USER_ACTION}}"
    expected: "{{EXPECTED_RESULT}} — same behavior as before {{CHANGE_DESCRIPTION}}"
  - number: 3
    action: "{{VERIFICATION_ACTION}}"
    expected: "No regressions: {{WHAT_WAS_PREVIOUSLY_WORKING}}"
automation:
  status: candidate
review:
  state: draft
  reviewers: []
version: 1
change_reason: "Added as regression guard for {{CHANGE_DESCRIPTION}}"
---

## Regression Context

<!-- Describe what changed (PR/ticket link) and why this test is needed. -->

**Change:** {{CHANGE_DESCRIPTION}}
**Ticket:** {{TICKET_LINK}}
**Introduced in:** {{VERSION_OR_DATE}}

## What Could Break

<!-- Enumerate the specific behaviors this test guards against regressing. -->

1. {{BEHAVIOR_1}}
2. {{BEHAVIOR_2}}

## Notes

<!-- Add any environment-specific considerations or known flakiness risks. -->
