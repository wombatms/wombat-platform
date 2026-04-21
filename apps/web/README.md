# Wombat Web

Read-only web frontend for the Wombat test-case-management platform. Vite + React 18 + TypeScript (strict) + Tailwind v4 + shadcn/ui, consuming SP2's FastAPI via a typed `openapi-fetch` client.

- **Design spec:** [`docs/superpowers/specs/2026-04-21-wombat-platform-sub-project-3-1-design.md`](../../../docs/superpowers/specs/2026-04-21-wombat-platform-sub-project-3-1-design.md)
- **Plan:** [`docs/plans/2026-04-21-wombat-platform-sub-project-3-1.md`](../../../docs/plans/2026-04-21-wombat-platform-sub-project-3-1.md)

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

- **Features** live in `src/features/{auth,library,shared-steps,stories,search,projects,settings,errors}/`.
- **Shared primitives:** shadcn-owned components in `src/components/ui/`, Wombat-specific shared components in `src/components/shared/`.
- **Data layer:** `src/lib/api/client.ts` (openapi-fetch with auth middleware + 401→refresh→retry), `src/lib/query/keys.ts` (query-key factory), `src/lib/auth/` (storage + deduped refresh queue).
- **Routing:** React Router v6 with v7 future flags enabled (`v7_startTransition`, `v7_relativeSplatPath`).
- **Auth:** access + refresh tokens in `localStorage` for MVP; httpOnly cookie migration is an explicit hardening item deferred to a later phase.

## UI changes — `frontend-design` skill required

Per spec §16, any task that produces user-facing UI **must invoke the `frontend-design` skill before writing component code**. This includes new screens, shared components, layout changes, empty/loading/error states, and theming work. The skill pushes the output past the default "generic AI UI" aesthetic toward the distinctive, token-driven look the PRD asks for in §14.9–14.12.

Reviewers check for the skill invocation at PR time on UI-producing tasks. Bypassing it is considered an incomplete task.
