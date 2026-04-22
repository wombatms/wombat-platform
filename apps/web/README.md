# Wombat Web

Web frontend for the Wombat test-case-management platform. Vite + React 18 + TypeScript (strict) + Tailwind v4 + shadcn/ui, consuming SP2's FastAPI via a typed `openapi-fetch` client.

SP3.2 added the first write path (proposal review + publish).
SP3.3 added manual + automated execution runs (create, record, close, reopen, rerun).

- **Design spec (SP3.1):** [`docs/superpowers/specs/2026-04-21-wombat-platform-sub-project-3-1-design.md`](../../../docs/superpowers/specs/2026-04-21-wombat-platform-sub-project-3-1-design.md)
- **Plan (SP3.1):** [`docs/plans/2026-04-21-wombat-platform-sub-project-3-1.md`](../../../docs/plans/2026-04-21-wombat-platform-sub-project-3-1.md)
- **Design spec (SP3.2):** [`docs/superpowers/specs/2026-04-21-wombat-platform-sub-project-3-2-design.md`](../../../docs/superpowers/specs/2026-04-21-wombat-platform-sub-project-3-2-design.md)
- **Plan (SP3.2):** [`docs/plans/2026-04-21-wombat-platform-sub-project-3-2.md`](../../../docs/plans/2026-04-21-wombat-platform-sub-project-3-2.md)
- **Design spec (SP3.3):** [`docs/superpowers/specs/2026-04-22-wombat-platform-sub-project-3-3-design.md`](../../../docs/superpowers/specs/2026-04-22-wombat-platform-sub-project-3-3-design.md)
- **Plan (SP3.3):** [`docs/plans/2026-04-22-wombat-platform-sub-project-3-3.md`](../../../docs/plans/2026-04-22-wombat-platform-sub-project-3-3.md)

## Prerequisites

- Node **20.10+** (see `.nvmrc` — current workspace uses 22.x, 20.10 is the floor)
- pnpm **9.12.0** (activate via `corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- A running Wombat API on `http://localhost:8000` for live development (optional for unit tests — they use MSW)

## Setup

```bash
cd /path/to/wombat-platform
pnpm install
```

Copy `.env.example` → `.env` if you need non-default values:

```
VITE_API_BASE_URL=http://localhost:8000
VITE_APP_TITLE=Wombat
```

## Run

```bash
pnpm --filter web dev        # Vite dev server on :5173 (proxies /api to VITE_API_BASE_URL)
pnpm --filter web build      # tsc -b && vite build → apps/web/dist/
pnpm --filter web preview    # serve dist/ locally
```

Start the API separately:

```bash
uv run uvicorn wombat_api.app:app --port 8000
```

## Tests

```bash
pnpm --filter web lint        # ESLint flat config (a11y + tailwindcss + react-hooks)
pnpm --filter web typecheck   # tsc --noEmit
pnpm --filter web test        # Vitest (jsdom + MSW + @testing-library)
pnpm --filter web test:watch  # interactive mode
pnpm --filter web test:e2e    # Playwright (chromium-light + chromium-dark)
```

Playwright requires a running API and Postgres:

```bash
# Run locally against a live stack
pnpm --filter web exec playwright install --with-deps chromium
# Boot Postgres + API (see wombat-platform/packages/api/README)
pnpm --filter web exec playwright test
```

Bundle + contract gates:

```bash
apps/web/scripts/check-bundle-budget.sh   # fails if initial JS > 350 KB gzipped
apps/web/scripts/check-openapi-drift.sh   # fails if schema.d.ts differs from live /openapi.json
```

## Regenerating the OpenAPI types

The typed API client is generated from the API's `/openapi.json`. The committed snapshot at `apps/web/openapi.snapshot.json` is the hermetic source for CI; `src/lib/api/schema.d.ts` is generated from it.

```bash
# Regenerate from the running API (writes schema.d.ts)
pnpm --filter web openapi:gen

# Refresh the hermetic snapshot too
curl -s http://localhost:8000/openapi.json | python -m json.tool > apps/web/openapi.snapshot.json
pnpm --filter web exec openapi-typescript apps/web/openapi.snapshot.json -o apps/web/src/lib/api/schema.d.ts
```

**Never hand-edit** `schema.d.ts`. CI's `check-openapi-drift.sh` enforces this.

## Themes

Themes are toggled via `data-theme="light|dark"` on `<html>`. An inline script in `index.html` restores the preference from `localStorage.wombat.theme` before React mounts, avoiding a flash.

- Semantic tokens live in `src/styles/tokens-light.css` and `src/styles/tokens-dark.css`.
- Components consume tokens via Tailwind utilities wired in `src/styles/index.css` under `@theme`.
- **Never hard-code hex** outside the two token files. If you need a new color, add it to both tokens files with the same semantic name.

## Content Security Policy (sample)

When deploying, serve with a strict CSP similar to:

```
Content-Security-Policy: default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  connect-src 'self' https://api.your-domain.example;
  font-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self'
```

Markdown bodies are sanitized at render time with `rehype-sanitize`; the CSP is belt-and-braces against stored XSS.

## Architecture pointers

- **Features** live in `src/features/{auth,library,shared-steps,stories,search,projects,settings,proposals,errors}/`.
- **Shared primitives:** shadcn-owned components in `src/components/ui/`, Wombat-specific shared components in `src/components/shared/` (including SP3.2's `MarkdownDiffSplit` and `FrontmatterDiffTable`).
- **Data layer:** `src/lib/api/client.ts` (openapi-fetch with auth middleware + 401→refresh→retry), `src/lib/query/keys.ts` (query-key factory), `src/lib/auth/` (storage + deduped refresh queue).
- **Routing:** React Router v6 with v7 future flags enabled (`v7_startTransition`, `v7_relativeSplatPath`).
- **Auth:** access + refresh tokens in `localStorage` for MVP; httpOnly cookie migration is an explicit hardening item deferred to a later phase.

## SP3.2 routes

| Route | Purpose |
|---|---|
| `/p/:slug/approvals` | Approvals inbox (virtualized list, filter pills, keyboard `j/k/o/a/r/w`) |
| `/p/:slug/approvals/:proposalId` | Review detail (frontmatter field diff + body split + action panel) |
| `/p/:slug/approvals/:proposalId/rebase` | Conflict resolution workspace (three-pane "your base / current main / your proposed") |
| `/p/:slug/:kind/:wombatId/edit` | Structured edit form + Markdown body editor; writes a proposal |
| `/p/:slug/:kind/new` | Create new content via the same edit form |

`:kind` is one of `testcase`, `shared_step`, `story`.

## SP3.2 permission model

Two new permissions extend SP2's RBAC:

| Permission | Default on role | Baked into role | Grantable per-token |
|---|---|---|---|
| `content:propose` | editor, admin | yes | implicit for any write-scope token |
| `content:publish_direct` | admin | yes | yes; off by default; admin must supply a non-empty `purpose` string at issuance |

Self-approval is blocked at the route layer. An admin who authored a proposal must either wait for another admin or use the direct-publish path (which bypasses the proposal flow entirely).

See `src/features/settings/TokensPage.tsx` for the admin token-grant UI; the `Advanced` disclosure on the create-token dialog flips the per-token flag and requires `purpose`.

## Regenerating `src/lib/api/schema.d.ts`

The TypeScript types in `src/lib/api/schema.d.ts` are generated from the API's live `/openapi.json`. Regenerate them whenever a backend route changes or a schema expands.

```bash
# From repo root, with the API running on :8000
pnpm --filter web openapi:gen

# Refresh the committed snapshot that CI's drift check compares against
curl -sf http://localhost:8000/openapi.json > apps/web/openapi.snapshot.json
```

Then re-run `pnpm --filter web typecheck && pnpm --filter web test` to confirm nothing regressed, and commit both files together. CI's `check-openapi-drift.sh` will fail if `schema.d.ts` and the live `/openapi.json` diverge.

## SP3.3 routes

| Route | Purpose |
|---|---|
| `/p/:slug/runs` | Runs list (status/environment/assignee facets, virtualized rows) |
| `/p/:slug/runs/new` | Create Run (3-tab Case Selector: Filter / Library / Paste IDs; inline-create environment) |
| `/p/:slug/runs/:id` | Run Detail (header, Cases + Evidence + Events tabs, reassign/close/reopen/rerun) |
| `/p/:slug/runs/:id/execute` | Runner (Focus Mode + Spreadsheet Grid); **lazy-loaded** via `React.lazy` |
| `/p/:slug/settings/environments` | Admin-only environments management (create/delete; the seeded `default` env cannot be deleted) |

The Runner route (`/runs/:id/execute`) is split out of the main bundle via
`React.lazy` so that project members who don't execute runs don't pay the
~13 KB (gzipped) Runner cost on every page load. The route-split is gated
by `apps/web/scripts/check-bundle-budget.sh` — see "Bundle + contract gates"
above.

### Runner keyboard shortcuts

The Runner is keyboard-first. All shortcuts are registered by
`useRunnerKeyboard` in `src/features/runs/runner/useRunnerKeyboard.ts` and
are shown in the in-app Help sheet (`?`).

| Key | Action |
|---|---|
| `p` | Record **Pass** on the current case |
| `f` | Record **Fail** on the current case |
| `b` | Record **Blocked** on the current case |
| `s` | Record **Skipped** on the current case |
| `n` | Focus **Notes** field |
| `a` | Attach **Evidence** (opens file picker) |
| `u` | Paste **Bug URL** (editable inline) |
| `g` then `g` | Open **Goto Case** dropdown |
| `v` | Toggle Focus ↔ **Spreadsheet** grid view |
| `?` | Show **Help** sheet (this table) |
| `←` / `→` | Previous / Next case (Focus Mode) |
| `↑` / `↓` | Previous / Next row (Grid Mode) |

Shortcuts are suppressed whenever a text input, textarea, or contenteditable
is focused. The `isCapturing` prop on `useRunnerKeyboard` is flipped to `true`
inside Notes / Bug URL fields to avoid `p/f/b/s` recording a result while
typing.

## Regenerating `schema.d.ts`

The TypeScript bindings at `src/lib/api/schema.d.ts` are generated from the
backend's OpenAPI document. Two sources of truth are kept in sync:

1. `apps/web/openapi.snapshot.json` — committed snapshot; the hermetic source
   for CI.
2. `apps/web/src/lib/api/schema.d.ts` — generated from the snapshot.

```bash
# Against a running API on :8000 (typical flow when the backend has changed)
pnpm --filter web openapi:gen
curl -sf http://localhost:8000/openapi.json > apps/web/openapi.snapshot.json
pnpm --filter web exec openapi-typescript apps/web/openapi.snapshot.json \
  -o apps/web/src/lib/api/schema.d.ts
```

Then `pnpm --filter web typecheck` and commit both files together. CI's
`check-openapi-drift.sh` will fail if `schema.d.ts` and the live
`/openapi.json` diverge.

## UI changes — `frontend-design` skill required

Per spec §16, any task that produces user-facing UI **must invoke the `frontend-design` skill before writing component code**. This includes new screens, shared components, layout changes, empty/loading/error states, and theming work. The skill pushes the output past the default "generic AI UI" aesthetic toward the distinctive, token-driven look the PRD asks for in §14.9–14.12.

Reviewers check for the skill invocation at PR time on UI-producing tasks. Bypassing it is considered an incomplete task.
