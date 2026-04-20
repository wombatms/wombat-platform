---
id: TC-PAYMENTS-REFUND-0012
title: Refund succeeds for captured card payment
summary: Verify the full refund flow for a credit card payment that has been captured.
status: active
priority: high
type: functional
component: payments
subcomponent: refunds
owner: qa-platform
tags:
  - payments
  - refunds
  - regression
  - critical-path
requirements:
  - REQ-PAY-442
  - REQ-PAY-443
preconditions:
  - User is logged in as a merchant admin
  - An order exists in Captured state with a credit card payment
  - The order total is $100.00
test_data:
  - "order_id: ORD-20240115-0042"
  - "payment_method: Visa ending 4242"
  - "refund_amount: 100.00"
shared_steps:
  - SS-MERCHANT-LOGIN-001
steps:
  - number: 1
    action: Navigate to Orders page
    expected: Orders list loads with search and filter controls
  - number: 2
    action: Search for order ORD-20240115-0042
    expected: Order appears in results with status "Captured"
  - number: 3
    action: Click on the order to open details
    expected: Order detail page loads showing payment information
  - number: 4
    action: Click the "Refund" button in the payment section
    expected: Refund confirmation dialog appears with order total pre-filled
  - number: 5
    action: Confirm the refund amount is $100.00 and click "Process Refund"
    expected: Success toast appears; order status changes to "Refunded"
  - number: 6
    action: Navigate to the payment processor dashboard and locate the transaction
    expected: Transaction shows a matched refund entry with status "Refunded"
automation:
  status: automated
  framework: playwright
  source: tests/e2e/payments/refund.spec.ts
review:
  state: approved
  reviewers:
    - qa-lead
    - payments-eng
version: 3
change_reason: Added payment processor verification step
---

## Notes

This test covers the happy path for full refunds only. Partial refund scenarios
are covered in TC-PAYMENTS-PARTIAL-REFUND-0013. The automation uses a seeded
test order that is reset between runs via the test data factory.
