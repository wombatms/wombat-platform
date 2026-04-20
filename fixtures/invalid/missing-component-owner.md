---
id: TC-PAYMENTS-NOOWNER-0001
title: Test case missing component and owner
status: active
priority: medium
type: functional
steps:
  - number: 1
    action: Do something
    expected: Something happens
---

This fixture is intentionally invalid: both `component` and `owner` required
fields are absent. The validator should report two missing field errors.
