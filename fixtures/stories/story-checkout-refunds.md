---
id: STORY-CHECKOUT-REFUNDS
title: Customers can request full and partial refunds for completed orders
description: >
  As a customer, I want to request refunds for items I've purchased so that
  I can recover funds for unsatisfactory or incorrectly fulfilled orders.
coverage: covered
linked_tests:
  - TC-PAYMENTS-REFUND-0012
linked_code:
  - src/payments/refund.py
  - src/api/routes/refunds.py
linked_docs:
  - docs/payments/refund-policy.md
risk: high
owner: product-payments
tags:
  - payments
  - refunds
  - customer-facing
version: 2
---

## Acceptance Criteria

- Customers can initiate a full refund within 30 days of purchase
- Partial refunds are supported down to $0.01
- Refund status is visible in order history within 60 seconds
- Funds are returned within 5-7 business days for card payments

## Risk Notes

High risk because refund processing involves external payment processor calls.
Failures here directly impact customer satisfaction and revenue reconciliation.
Any change to the refund flow must include regression of TC-PAYMENTS-REFUND-0012.
