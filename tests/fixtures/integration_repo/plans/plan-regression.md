---
id: PLAN-INT-REGRESSION
title: Integration Regression Plan
description: Full regression plan for integration tests.
scope:
  product: wombat-integration
include:
  components_any:
    - auth
    - payments
  priorities:
    - critical
    - high
exclude:
  tags_any:
    - deprecated
environments:
  - name: staging
    config:
      base_url: https://staging.example.com
execution: mixed
assignees:
  - qa-platform
approvals:
  - qa-lead
version: 1
---

Regression test plan covering auth and payments components.
