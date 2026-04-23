---
id: PLAN-RELEASE-2026-05
title: May 2026 Release Validation
description: Full release validation across all components for the 2026.05 release.
scope:
  product: wombat-shop
  release: "2026.05"
include:
  tags_any:
    - critical-path
    - regression
    - smoke
  priorities:
    - critical
    - high
exclude:
  tags_any:
    - deprecated
    - manual-only
  components_any: []
environments:
  - name: staging-us
    config:
      base_url: https://staging-us.wombat-shop.example.com
      release_tag: "2026.05-rc1"
  - name: staging-eu
    config:
      base_url: https://staging-eu.wombat-shop.example.com
      release_tag: "2026.05-rc1"
  - name: prod-canary
    config:
      base_url: https://canary.wombat-shop.example.com
      release_tag: "2026.05-rc1"
      traffic_percent: "5"
execution: mixed
assignees:
  - payments-qa
  - qa-auth-team
  - qa-checkout-team
  - qa-platform
approvals:
  - qa-lead
  - release-manager
  - vp-engineering
explicit_cases:
  add:
    - TC-PAYMENTS-CHECKOUT-0001
    - TC-AUTH-LOGIN-0001
    - TC-CHECKOUT-CART-0001
  remove: []
---

## Release Validation Plan

This plan covers critical-path and regression tests across all product areas
for the 2026.05 release.

### Phases

1. **Smoke** — critical-path tests in staging-us (automated)
2. **Regression** — full regression in staging-us and staging-eu (mixed)
3. **Canary** — smoke tests against 5% canary traffic in production

### Sign-Off Requirements

- All smoke tests green before regression begins
- Zero P0/P1 defects open at regression completion
- Three approvals required: qa-lead, release-manager, vp-engineering
