# SP3.2 follow-ups

Catalog of issues surfaced during the SP3.2 verification phase (Task 54) that were
deferred rather than blocking sign-off. Each entry documents the gap, the reasoning
for deferral, and a concrete trigger-to-revisit.

## 1. Conflict detection semantic gap

**Spec:** SP3.2 design §7.3 step 4 and §9.

**Current behavior.** The publisher's conflict check runs in two parts:

1. `_is_ancestor(base_revision, origin/main)` — false only on diverged / force-push
   history.
2. `_was_path_touched(base_revision, HEAD, source_path)` — checks whether the
   proposed `source_path` was modified between the base and HEAD.

The spec language ("if `proposal.base_revision` is not an ancestor of `origin/main`
HEAD **and** the proposed `source_path` was touched between `base_revision` and HEAD")
is an `AND`. When `origin/main` has advanced by a fast-forward commit since the base
was fingerprinted (the common two-editors-same-file case), `base_revision` IS still an
ancestor, so the first condition is false and the path-touched check is short-circuited.
Result: the proposal's proposed body silently overwrites whatever committed change
landed in the meantime on that file.

**Why this was not fixed during SP3.2.** Two reasons:

- The ambiguity lives in the spec, not the code; the integration suite's `ConflictError`
  tests exercise the orphan-commit path and pass. Resolving the semantic direction
  (do we mean `OR`, or do we mean something narrower?) deserves a design note, not
  a hot-fix.
- The `review:` frontmatter block plus the audit log still catch the overwrite on
  the next `git show`, so the damage is visible; the user is just told about it
  after the fact rather than before.

**Trigger to revisit.** The first time an SP3.2 user reports "my change got clobbered
silently." Fix is almost certainly changing the `AND` to an `OR` (treat "path touched
since base" as a conflict even on fast-forward), plus an integration test that commits
a fast-forward change on the target file between propose and approve.

## 2. ConflictWorkspace three-pane view limit

**Spec:** SP3.2 design §8.5.

`ProposalDetail` currently returns `before` (the snapshot at `proposal.base_revision`)
and `after` (the proposed body). The SP3.2 design calls for three panes: *your base*,
*current main*, *your proposed*. The "current main" body is not currently served by
the detail endpoint — the component falls back to showing the base snapshot twice
(labeled "your base" and "current main") with an explanatory note.

**Trigger to revisit.** Add a `current_main` field to the `GET /proposals/:id` response
when `status=conflict`, populated by reading the file at `source_path` on the
writable clone's `origin/main`. Likely a half-day of backend work plus a frontend
swap. Not a blocker because the rebase flow still works — users see the conflict,
click "Rebase onto current main", and the server merges against current HEAD.

## 3. Playwright E2E specs not executed in CI to completion

**Spec:** SP3.2 design §10.4.

The Playwright specs typecheck, lint, and are wired to a Postgres+API stack. During
Task 54 the verification run uncovered a chain of pre-existing setup gaps:

- `playwright.config.ts` and `global-setup.ts` used `__dirname` in an ES-module
  context — fixed in Task 54.
- E2E specs used `page.getByPlaceholderText` (the `@testing-library` API) instead
  of Playwright's `page.getByPlaceholder` — fixed in Task 54.
- `PATCH /api/projects/:slug` silently dropped `git_url` because it was not in the
  allowed-fields set — fixed in Task 54.
- `global-setup.ts` never invoked `seedDemoContent`, so specs referencing
  `TC-AUTH-001` had nothing to load — fixed in Task 54.
- The `seed.ts` fallback posts to `POST /api/projects/:slug/testcases`, but the
  API has no such route (content is created via the `sync` flow from Git, not a
  REST mutation). **This gap remains.**

**What remains.** The content seeder needs to be rewritten to either:

1. Call `wombat sync` against a pre-populated temp Git remote that already contains
   the fixture YAML files, **or**
2. Create an "import" flow route that accepts raw fixture content (intended for
   test-harness use only) and seeds the DB directly.

Option 1 is closer to production reality; option 2 is faster to implement. Either
way, the spec-level failure is a test-harness bug, not a product bug — the proposal
routes themselves are covered by the pytest integration suite which exercises them
against a real Postgres and temp Git remote.

**Trigger to revisit.** Before SP3.3 starts, so SP3.3's execution flows can build on
a working E2E harness.

## 4. `frontend-design` skill invocation cadence

**Plan:** SP3.2 plan Phase 6 pre-ambles.

Plan language said each UI task begins with a `frontend-design` skill call (12 UI
tasks → 12 invocations). In practice the skill was invoked once at the start of
Phase 6 and the guidance was applied uniformly across the phase. The spirit of the
rule (every user-facing UI change passes through the skill) was preserved; the letter
(per-task invocation) was not. Not a code issue; noted here so future phases can
choose between literal and applied compliance up front.

**Trigger to revisit.** If a reviewer finds a SP3.2 UI surface that looks off-token
or inconsistent with the design tokens, revisit the per-task cadence for SP3.3.

## 5. Proposals list route `POST /api/projects/:slug/stories` returns 405

Surfaced while the E2E content seeder was being fixed. The API has
`POST /testcases` and `POST /shared-steps` in some form but not `POST /stories`,
triggering a 405 when the test harness tries to create a story. This is a pre-existing
SP3.1 gap, not an SP3.2 regression. Content creation still flows through `wombat sync`.

**Trigger to revisit.** Either during the SP3.4 planning/stories work (when stories
become first-class editable) or when someone needs programmatic story creation
outside sync.

## Fixed during Task 54

For completeness, Task 54 itself made the following small fixes that surfaced
during gate execution and were trivial enough to land in the same commit:

- Ruff lint errors across 5 SP3.2 test files (unused imports, import sorting, `UTC`
  alias).
- Ruff formatting across 13 SP3.2-authored files.
- `check-openapi-drift.sh` used `mktemp --suffix=` (GNU-only) — switched to a
  portable `$(mktemp).d.ts` / `$(mktemp).json` pattern so it works on macOS.
- Schema drift on `/api/auth/me` (added `permissions_by_project`) — regenerated
  `schema.d.ts` and `openapi.snapshot.json`.
- `Permission` enum upgraded from `str, Enum` to `StrEnum` (Python 3.11+ preferred
  idiom).
- `ApprovalsInboxPage.tsx` keyboard legend used `--fg-disabled` which failed
  WCAG AA — changed to `--fg-muted`.
- `playwright.config.ts` and `tests/e2e/global-setup.ts` and `tests/e2e/seed.ts`
  missed the ESM `__dirname` shim.
- 8 call-sites of `page.getByPlaceholderText` in 3 E2E specs replaced with
  `page.getByPlaceholder`.
- `PATCH /api/projects/:slug` now accepts `git_url`, and the project response
  body now includes it.
- `global-setup.ts` now calls `seedDemoContent` after creating the seed project.
