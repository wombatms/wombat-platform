---
id: TC-INT-PAY-001
title: Refund eligibility check for completed orders
summary: Verify that refund eligibility is determined correctly for completed orders.
status: active
priority: critical
type: functional
component: payments
owner: qa-payments
tags:
  - payments
  - refund
  - regression
steps:
  - number: 1
    action: Navigate to order history
    expected: Orders list loads
  - number: 2
    action: Select a completed order
    expected: Order detail page loads with refund button
  - number: 3
    action: Click Request Refund
    expected: Refund eligibility modal opens
version: 1
---

This test verifies refund eligibility logic for the payments component.
