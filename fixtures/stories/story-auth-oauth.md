---
id: STORY-AUTH-OAUTH
title: Users can authenticate using Google or GitHub OAuth
description: >
  As a new or returning user, I want to sign in with my existing Google or GitHub
  account so that I don't need to manage a separate password for this platform.
coverage: partial
linked_tests:
  - TC-AUTH-OAUTH-0002
linked_code:
  - src/auth/oauth.py
  - src/auth/providers/google.py
linked_docs:
  - docs/auth/oauth-setup.md
risk: medium
owner: product-auth
tags:
  - auth
  - oauth
  - sso
version: 1
---

## Acceptance Criteria

- Users can initiate OAuth login via Google (MVP)
- Users can initiate OAuth login via GitHub (future)
- New users are automatically provisioned on first OAuth sign-in
- Existing users can link an OAuth provider to their password account
- OAuth tokens are never stored; only the user identity claim is persisted

## Coverage Gaps

GitHub OAuth is not yet tested (TC-AUTH-OAUTH-0002 covers Google only).
Tracking in STORY-AUTH-GITHUB-OAUTH for future sprint.
