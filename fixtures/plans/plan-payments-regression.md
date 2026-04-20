---
id: PLAN-PAYMENTS-REGRESSION
title: Payments Component Regression Suite
description: Full regression coverage for the payments component, run before every release.
scope:
  product: wombat-shop
include:
  components_any:
    - payments
  priorities:
    - critical
    - high
    - medium
exclude:
  tags_any:
    - deprecated
    - wip
environments:
  - name: staging-us
    config:
      base_url: https://staging-us.wombat-shop.example.com
      payment_gateway: stripe-test
  - name: staging-eu
    config:
      base_url: https://staging-eu.wombat-shop.example.com
      payment_gateway: stripe-test-eu
execution: mixed
assignees:
  - payments-qa
  - qa-platform
approvals:
  - qa-lead
  - release-manager
---

## Scope

Covers all active and non-deprecated test cases in the `payments` component.
Excludes work-in-progress tests. Run in both US and EU staging environments
before cutting a release branch.

## Exit Criteria

- All critical and high priority tests pass in both environments
- No open P1 defects in payments
- Regression delta compared to previous run reviewed by qa-lead
