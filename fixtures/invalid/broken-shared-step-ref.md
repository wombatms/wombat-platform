---
id: TC-AUTH-BROKENREF-0001
title: Test case with a broken shared step reference
status: active
priority: high
type: functional
component: auth
owner: qa-auth-team
shared_steps:
  - SS-NONEXISTENT-999
steps:
  - number: 1
    action: Perform login using shared steps
    expected: User is authenticated
---

This fixture is intentionally invalid: it references `SS-NONEXISTENT-999`
which does not exist in the fixture set. The validator should raise a broken
reference error when resolving shared step IDs.
