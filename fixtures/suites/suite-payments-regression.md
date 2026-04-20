---
id: SUITE-PAYMENTS-REGRESSION
title: Payments Regression Suite
description: All regression-tagged test cases for the payments component.
cases:
  - TC-PAYMENTS-REFUND-0012
  - TC-PAYMENTS-CHECKOUT-0001
include:
  components_any:
    - payments
  tags_any:
    - regression
  priorities:
    - critical
    - high
    - medium
owner: qa-platform
tags:
  - payments
  - regression
---

## Purpose

This suite groups all regression tests for the payments component. It is
used by PLAN-PAYMENTS-REGRESSION as a scope anchor and can also be run
independently during payments-focused development cycles.
