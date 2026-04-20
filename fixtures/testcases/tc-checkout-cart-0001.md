---
id: TC-CHECKOUT-CART-0001
title: Guest user adds item to cart and views cart summary
summary: Verify cart state is maintained for guest users and totals are calculated correctly.
status: active
priority: medium
type: functional
component: checkout
subcomponent: cart
owner: qa-checkout-team
tags:
  - checkout
  - cart
  - guest
  - regression
requirements:
  - REQ-CART-001
  - REQ-CART-002
preconditions:
  - User is browsing as a guest (no login)
  - Product SKU-001 is in stock with price $29.99
test_data:
  - "product_sku: SKU-001"
  - "product_price: 29.99"
  - "quantity: 2"
  - "expected_total: 59.98"
shared_steps:
  - SS-ADD-TO-CART-001
steps:
  - number: 1
    action: Navigate to the product page for SKU-001
    expected: Product page loads showing price $29.99 and "Add to Cart" button
  - number: 2
    action: Set quantity to 2 and click "Add to Cart"
    expected: Cart icon in header updates to show count "2"; success toast appears
  - number: 3
    action: Click the cart icon to open the cart drawer
    expected: Cart drawer opens showing SKU-001 x2 with subtotal $59.98
  - number: 4
    action: Click "View Cart" to go to the full cart page
    expected: Cart page loads with correct line item, quantity, and total
  - number: 5
    action: Reload the page
    expected: Cart contents persist after page reload (stored in session/cookie)
automation:
  status: automated
  framework: playwright
  source: tests/e2e/checkout/cart.spec.ts
review:
  state: approved
  reviewers:
    - qa-checkout-team
version: 1
---
