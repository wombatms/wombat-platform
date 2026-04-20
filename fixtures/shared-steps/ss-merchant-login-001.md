---
id: SS-MERCHANT-LOGIN-001
title: Merchant admin login
owner: qa-platform
tags:
  - auth
  - merchant
  - admin
variables:
  - merchant_email
  - merchant_password
steps:
  - number: 1
    action: Navigate to /admin/login
    expected: Merchant login page loads with email and password fields
  - number: 2
    action: Enter {merchant_email} in the email field
    expected: Email field shows entered value
  - number: 3
    action: Enter {merchant_password} in the password field
    expected: Password field shows masked characters
  - number: 4
    action: Click "Sign In to Dashboard"
    expected: Merchant admin dashboard loads; user role badge shows "Admin"
version: 1
---

## Usage

Reference this shared step in payment and order management test cases that
require merchant admin access.

Default test credentials: `merchant-qa@example.com` / `MerchantPass123!`
