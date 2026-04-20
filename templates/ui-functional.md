---
id: TC-COMPONENT-FEATURE-XXXX
title: "{{FEATURE}} renders and behaves correctly under normal conditions"
summary: "Verify the {{FEATURE}} UI component functions as expected for a typical user interaction."
status: draft
priority: medium
type: ui
component: "{{COMPONENT}}"
subcomponent: "{{SUBCOMPONENT}}"
owner: "{{OWNER}}"
tags:
  - ui
  - functional
requirements:
  - "{{REQ_ID}}"
preconditions:
  - "User is logged in"
  - "{{PRECONDITION}}"
steps:
  - number: 1
    action: "Navigate to {{URL_OR_PAGE}}"
    expected: "{{FEATURE}} is visible and in its initial state"
  - number: 2
    action: "{{USER_ACTION}}"
    expected: "{{EXPECTED_RESULT}}"
  - number: 3
    action: "{{USER_ACTION}}"
    expected: "{{EXPECTED_RESULT}}"
automation:
  status: candidate
review:
  state: draft
  reviewers: []
version: 1
---

## Overview

<!-- Describe what this test validates and why it matters. -->

## Test Data

<!-- List any specific test data values, accounts, or fixtures needed. -->

## Notes

<!-- Add implementation notes, related tests, or edge cases to be aware of. -->
