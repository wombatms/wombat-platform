---
id: TC-PAYMENTS-CHECKOUT-0001
title: Checkout completes with valid credit card
summary: Verify end-to-end checkout flow with a valid Visa credit card.
status: active
priority: critical
type: functional
component: payments
subcomponent: checkout
owner: qa-platform
tags:
  - payments
  - checkout
  - smoke
  - critical-path
requirements:
  - REQ-CHK-001
preconditions:
  - Guest user or logged-in customer with items in cart
  - At least one item with sufficient inventory
test_data:
  - "card_number: 4111111111111111"
  - "expiry: 12/28"
  - "cvv: 123"
  - "billing_zip: 94107"
shared_steps:
  - SS-ADD-TO-CART-001
steps:
  - number: 1
    action: Proceed to checkout from cart page
    expected: Checkout page loads with shipping address form
  - number: 2
    action: Enter a valid shipping address and click Continue
    expected: Payment method step is shown
  - number: 3
    action: Enter test card number 4111111111111111, expiry 12/28, CVV 123
    expected: Card fields accept input; Visa logo appears
  - number: 4
    action: Click "Place Order"
    expected: Loading indicator shows; order confirmation page appears within 5 seconds
  - number: 5
    action: Note the order confirmation number
    expected: Confirmation number matches format ORD-YYYYMMDD-XXXX
automation:
  status: automated
  framework: playwright
  source: tests/e2e/checkout/checkout-card.spec.ts
review:
  state: approved
  reviewers:
    - qa-lead
version: 2
---

## Notes

Uses Stripe test card 4111111111111111. Do not run against production environment.
