---
id: TC-COMPONENT-NEGATIVE-XXXX
title: "{{FEATURE}} rejects {{INVALID_INPUT_DESCRIPTION}}"
summary: "Verify that {{FEATURE}} handles invalid/unexpected input gracefully with appropriate error feedback."
status: draft
priority: medium
type: negative
component: "{{COMPONENT}}"
subcomponent: "{{SUBCOMPONENT}}"
owner: "{{OWNER}}"
tags:
  - negative
  - error-handling
requirements:
  - "{{REQ_ID}}"
preconditions:
  - "{{PRECONDITION}}"
test_data:
  - "invalid_input: {{INVALID_VALUE_DESCRIPTION}}"
  - "expected_error: {{EXPECTED_ERROR_MESSAGE_OR_CODE}}"
steps:
  - number: 1
    action: "Navigate to {{URL_OR_FEATURE_ENTRY_POINT}}"
    expected: "Feature loads in normal state"
  - number: 2
    action: "Attempt {{INVALID_ACTION_DESCRIPTION}} with input: {{INVALID_INPUT}}"
    expected: "System rejects the action — does NOT process or accept the input"
  - number: 3
    action: "Observe the error feedback presented to the user"
    expected: "Error message '{{EXPECTED_ERROR_MESSAGE}}' is shown; no sensitive details are exposed"
  - number: 4
    action: "Verify system state after the rejection"
    expected: "No partial state changes occurred; system is in the same state as before the attempt"
automation:
  status: candidate
review:
  state: draft
  reviewers: []
version: 1
---

## Invalid Input Catalog

<!-- Document all invalid inputs this test covers and the expected rejection behavior for each. -->

| Input | Reason Invalid | Expected Error |
|-------|---------------|----------------|
| `{{INVALID_INPUT_1}}` | `{{REASON_1}}` | `{{ERROR_1}}` |
| `{{INVALID_INPUT_2}}` | `{{REASON_2}}` | `{{ERROR_2}}` |

## Security Considerations

<!-- If this negative test has security implications (injection, auth bypass, etc.), note them here. -->

## Related Tests

<!-- Link to the positive/happy-path version of this test. -->
