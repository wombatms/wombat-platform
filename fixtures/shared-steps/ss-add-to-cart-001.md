---
id: SS-ADD-TO-CART-001
title: Add product to cart by SKU
owner: qa-checkout-team
tags:
  - checkout
  - cart
variables:
  - product_sku
  - quantity
  - expected_price
steps:
  - number: 1
    action: Navigate to the product listing page and search for {product_sku}
    expected: Product appears in search results with price matching {expected_price}
  - number: 2
    action: Click on the product to open its detail page
    expected: Product detail page loads showing SKU {product_sku}
  - number: 3
    action: Set quantity to {quantity} and click "Add to Cart"
    expected: Cart icon updates showing {quantity} item(s); success notification appears
version: 1
---

## Usage

Use this shared step whenever a test needs items in the cart before testing
checkout, payment, or cart-management features.

Variables:
- `product_sku` — the product SKU to add (e.g. `SKU-001`)
- `quantity` — number of units to add (default: 1)
- `expected_price` — unit price shown on the product page for assertion
