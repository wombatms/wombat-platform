# wombat-api

FastAPI application for the Wombat test management platform.

## Evidence storage (SP3.3)

Run attachments (screenshots, logs, trace files) are stored in a pluggable
evidence backend. The backend is selected with `WOMBAT_EVIDENCE_BACKEND` and
initialised once at server startup via the FastAPI lifespan hook; all route
handlers obtain it through `Depends(get_evidence_backend)`.

### Backend options

| `WOMBAT_EVIDENCE_BACKEND` | Description |
|---------------------------|-------------|
| `localfs` (default)       | Writes blobs under `WOMBAT_EVIDENCE_ROOT` on the local filesystem; serves signed URLs from the API process |
| `s3`                      | Stores blobs in S3 (or any S3-compatible store such as MinIO or Cloudflare R2); returns presigned S3 URLs |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `WOMBAT_EVIDENCE_BACKEND` | `localfs` | `localfs` or `s3` |
| `WOMBAT_EVIDENCE_ROOT` | `./var/evidence` | LocalFS: root directory for blob storage |
| `WOMBAT_EVIDENCE_SIGNING_KEY` | *(none)* | LocalFS: HMAC secret for signed URL generation; generate with `openssl rand -hex 32` |
| `WOMBAT_EVIDENCE_MAX_FILE_MB` | `25` | Per-file upload size cap (MiB) |
| `WOMBAT_EVIDENCE_BUCKET` | *(none)* | S3: bucket name |
| `WOMBAT_EVIDENCE_REGION` | *(none)* | S3: AWS region (e.g. `us-east-1`) |
| `WOMBAT_EVIDENCE_ENDPOINT_URL` | *(none)* | S3: custom endpoint URL for MinIO/R2/compatible stores |
| `WOMBAT_EVIDENCE_PREFIX` | `evidence/` | S3: key prefix applied to all objects |

### LocalFS setup (development)

```bash
mkdir -p var/evidence
export WOMBAT_EVIDENCE_BACKEND=localfs
export WOMBAT_EVIDENCE_ROOT=./var/evidence
export WOMBAT_EVIDENCE_SIGNING_KEY=$(openssl rand -hex 32)
```

Signed URLs returned by `GET /evidence/{id}/url` are served by the API process
itself and expire after 300 seconds (5 minutes) by default.

### S3 / MinIO setup

For production use AWS S3:

```bash
export WOMBAT_EVIDENCE_BACKEND=s3
export WOMBAT_EVIDENCE_BUCKET=my-wombat-evidence
export WOMBAT_EVIDENCE_REGION=us-east-1
```

For local development with MinIO:

```bash
# Start MinIO
docker run -d --name minio \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

# Create the bucket
docker exec minio mc alias set local http://localhost:9000 minioadmin minioadmin
docker exec minio mc mb local/wombat-evidence

# Configure the API
export WOMBAT_EVIDENCE_BACKEND=s3
export WOMBAT_EVIDENCE_BUCKET=wombat-evidence
export WOMBAT_EVIDENCE_REGION=us-east-1
export WOMBAT_EVIDENCE_ENDPOINT_URL=http://localhost:9000
export AWS_ACCESS_KEY_ID=minioadmin
export AWS_SECRET_ACCESS_KEY=minioadmin
```

Presigned MinIO URLs honour `WOMBAT_EVIDENCE_ENDPOINT_URL` automatically via
the boto3 client configuration.

### Tuning `WOMBAT_EVIDENCE_MAX_FILE_MB`

The per-file upload cap defaults to **25 MiB**. It is enforced at three layers:

1. **Pre-sign**: `POST /api/projects/:slug/runs/:id/cases/:cid/result/evidence:attach`
   rejects requests whose `size_bytes` exceeds the limit before returning a
   signed URL (LocalFS) or presigned POST (S3).
2. **Upload**: the signed URL is bound to the exact `size_bytes` claimed at
   pre-sign time; a larger body fails at upload.
3. **Confirm**: `POST /evidence/:id/confirm` verifies `content_length` against
   the cap and the signed claim.

Raise the limit by setting `WOMBAT_EVIDENCE_MAX_FILE_MB=100` (or higher) in
the API environment. Large values require that your S3 bucket or LocalFS
filesystem can accommodate the increased storage.

## Runs permissions (SP3.3)

Every run write operation is gated by a `runs:*` permission. Role defaults:

| Role      | `runs:view` | `runs:create` | `runs:assign` | `runs:record` | `runs:close` |
|-----------|:---:|:---:|:---:|:---:|:---:|
| `viewer`  | Y  | -  | -  | -  | -  |
| `editor`  | Y  | Y  | Y  | Y  | Y  |
| `admin`   | Y  | Y  | Y  | Y  | Y  |

Tokens inherit the scopes set at issuance. A token scoped only to `runs:record`
can report results for runs it is assigned to (see the next section for the
CI-account gate) but cannot create, close, or reassign runs.

### CI-account gate

When a token records a result on a run, the server evaluates the following
sequence (see `packages/api/src/wombat_api/rbac/guards.py::assert_run_actor_authorized`):

1. If the principal is a user (not a token) with `runs:record`, allow.
2. If the principal is a token and the token's owning user is an **admin**
   on the project, allow.
3. If the principal is a token and the token `id` appears in
   `run_assignees.token_id` for this run, allow.
4. Otherwise return `403 run_actor_not_authorized`.

This enforces the SP3.3 design invariant that CI-scoped tokens can only
record into runs they were assigned to at creation time. Reassignment (via
`PATCH /api/projects/:slug/runs/:id`) updates the allowlist in place.

## Publisher setup (SP3.2)

The proposal publisher writes approved content changes directly to the project's Git repository. It requires a working clone of each project's repo on the host running the API server.

### `WOMBAT_GIT_WORKSPACE_ROOT`

Set this environment variable to a directory where the API process has read/write access. The publisher creates one subdirectory per project (named by project UUID). Default: `.wombat/workspace`.

```
WOMBAT_GIT_WORKSPACE_ROOT=/var/wombat/workspace
```

### Credentials flow

The API server process must be able to push to each project's `git_url` without a password prompt. Use one of:

- **SSH key**: place the private key in `~/.ssh/` for the user running the API (or set `GIT_SSH_COMMAND` to point at a specific key). Add the public key as a deploy key with write access on the remote.
- **HTTPS with a PAT**: store credentials in `~/.netrc` or use `git credential store`. On GitHub/Azure DevOps, issue a Personal Access Token with `Contents: write` scope.

The credentials must be configured before the first proposal is approved, because the publisher calls `git clone` lazily on the first publish for each project.

### Initial clone (optional)

The publisher will clone automatically on the first approval. To pre-populate or verify the clone:

```bash
git clone <project-git-url> /var/wombat/workspace/<project-uuid>
```

### Verify push rights

Before going to production, confirm the server can push:

```bash
git -C /var/wombat/workspace/<project-uuid> push --dry-run origin main
```

A `0` exit code confirms credentials and remote write access are correctly configured. Any non-zero result will surface as a `push_failed` error in the API response.

### Wiring `git_url` into a project

Each project's remote URL is stored on the `projects.git_url` column. It must be populated before the first proposal is approved; otherwise the publisher returns `no_git_url_configured`.

Two ways to set it:

```bash
# 1. Via the API (admin token required):
curl -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"git_url": "git@github.com:your-org/your-repo.git"}' \
  "https://wombat.example.com/api/projects/your-slug"

# 2. Direct SQL (requires DB access):
psql -c "UPDATE projects SET git_url = 'git@...' WHERE slug = 'your-slug';"
```

The API returns `git_url` on `GET /api/projects/:slug` so you can verify after setting it.

## Direct-publish token issuance (SP3.2, operator-only)

API tokens with `publish_direct=true` skip the proposal review step and commit straight to `origin/main`. The blast radius is wider than a normal token, so:

1. **Admin-only issuance.** Only users with the `admin` role on a project may call `POST /api/auth/tokens` with `publish_direct=true` on any of that project's scopes.
2. **`purpose` is mandatory.** The request must include a non-empty `purpose` string (e.g. `"CI smoke test publisher"`, `"migration backfill 2026-Q2"`). The server rejects the request otherwise.
3. **`purpose` is audit-visible.** Every `direct_published` event recorded for this token stores the original `purpose` in `proposal_event.detail.purpose`, so audit reports survive token revocation.
4. **Default off.** Omitting `publish_direct` (or passing `false`) issues a normal token that must route through the approvals inbox.

When a direct-publish token commits a change, the commit message includes the `Published-directly-by:` and `Purpose:` trailers so `git log` on `origin/main` always shows the bypass chain.

To revoke a direct-publish token without losing audit history, use `DELETE /api/auth/tokens/:id` — existing proposal_event rows retain the purpose string even after the token row is removed.

## SP3.4 surface — Planning + Dashboards

SP3.4 is an **additive** phase with **zero new tables**. Plans and suites are rows in the existing `content` table (`kind='plan' | 'suite'`). Writes flow through SP3.2's `POST /proposals`. Migration `007_sp3_4_planning_dashboards` is indexes-only plus a defensive one-shot reshape of any legacy `plan.body.explicit_cases` rows.

### Subpackages

| Path | Purpose |
|------|---------|
| `src/wombat_api/planning/` | `ResolveService`, `/content/resolve`, plan/suite `resolve`/`clone`/`start-run` helpers. Reuses SP3.2 `ContentService` + `ProposalService`. |
| `src/wombat_api/dashboards/` | `WidgetRegistry`, five widget query functions under `dashboards/widgets/`, `/dashboards/widget/{slug}` dispatcher. |

### Widget registration contract

Each widget is a `(meta, query)` pair registered at import time. `meta` declares its slug, title, supported scopes (`project` | `plan`), and required filter keys (e.g. `release_readiness` requires `plan_id` on `scope=project`).

```python
# packages/api/src/wombat_api/dashboards/widgets/my_widget.py
from wombat_api.dashboards.registry import REGISTRY, WidgetMeta

async def query(scope, filters, session):
    # return a plain dict; shape is opaque to the registry
    ...

META: WidgetMeta = {
    "slug": "my_widget",
    "title": "My widget",
    "scope_kinds": {"project", "plan"},
    "requires": [],
}

REGISTRY.register(META, query)
```

Add a sixth widget: write the module, import it in `dashboards/widgets/__init__.py` to trigger registration, and add a matching React component in `apps/web/src/features/dashboards/widgets/`. No core route changes required.

### Performance targets

- `POST /content/resolve` — **p95 < 300 ms** at project with ≤ 2,000 content rows and suite depth ≤ 5.
- `GET /dashboards/widget/{slug}` — **p95 < 500 ms** per widget at ≤ 5,000 results in window.
- Widget breaches trigger the explicit follow-up to move that widget to a pre-aggregated rollup table (see `Deferred follow-ups` below).
- Each resolve + widget query emits a structured log line with project, filter hash, and duration for percentile calibration.

### Indexes added by migration 007

All are additive; the migration only creates an index if one of the same name doesn't already exist.

| Index | Table | Widgets served |
|-------|-------|----------------|
| `ix_results_run_finished` | `results (run_id, updated_at DESC)` | `passfail_trend`, `top_failing_cases` |
| `ix_runs_project_finished` | `runs (project_id, closed_at DESC NULLS LAST)` | `recent_runs` |
| `ix_runs_project_plan_finished` | `runs (project_id, plan_id, closed_at DESC NULLS LAST)` | plan-home + `release_readiness` |
| `ix_proposals_project_status` | `proposals (project_id, status)` | `review_backlog` |
| `ix_runs_environment_finished` | `runs (environment_id, closed_at DESC NULLS LAST)` | env-filtered widgets |

Expression indexes (`DESC NULLS LAST`) are Postgres-only; the migration falls back to a plain column list on SQLite test fixtures.

### Permission model — no new slugs

SP3.4 reuses the existing permission matrix. No changes to `packages/api/src/wombat_api/rbac/permissions.py`.

- Plan / suite reads — authenticated + project-scoped (same as any content read).
- Plan / suite writes — `content:propose` (route `POST /proposals` with `kind=plan|suite`) or `content:publish_direct` (bypass).
- Dashboard widgets that read runs/results — `runs:read`.
- Runs launched from a plan — `runs:create`.

### Suite hierarchy — single-parent tree, cycle-safe writes

`Suite.parent_wombat_id` is optional and must reference another suite in the same project. Cycle prevention runs at two layers:

1. **Lint (Git-source writes)** — `SUITE_CYCLE`, `SUITE_SELF_PARENT`, `PLAN_SUITE_REF_UNKNOWN` rules in `wombat_core.linting.rules.suite_hierarchy`.
2. **Service (API proposals)** — `_validate_suite_proposal` in `routes/proposals.py` walks the parent chain at proposal-create time; rejects self-reference, cycles, and cross-project parents with `SUITE_CYCLE` / `SUITE_PARENT_OTHER_PROJECT` (HTTP 422).

Resolution depth is hard-capped at 20 (defensive; cycle check is primary). `Repository.list_suite_subtree` uses a recursive Postgres CTE in one round-trip; the SQLite test path falls back to Python iteration.

### MCP additions (SP3.4)

Four new tools are registered in `packages/mcp/` (surface: 31 → 35 tools):

- `save_plan` / `save_suite` — proposal write via the same SP3.2 flow
- `resolve_plan` — preview a plan body (or stored `wombat_id`) before saving
- `get_dashboard_widget` — fetch a widget's data shape by slug

### Deferred follow-ups surfaced during SP3.4

| # | Item | Trigger to address |
|---|---|---|
| 1 | `CreateRunRequest.plan_id` field | Plan→Run handoff currently pre-fills the form; server doesn't persist `plan_id` on submit. Small backend patch — `runs.plan_id` column already exists since SP3.3. |
| 2 | `/testcases?suite_ref=` server-side filter | Library suites sidebar filters client-side today. Add when suite subtrees grow large. |
| 3 | `/components` catalog endpoint | `FilterBuilder` uses free-text. Add once `component` is a first-class field. |
| 4 | Pre-aggregated widget rollups | Revisit when any widget p95 exceeds 500 ms. |
| 5 | Plan version-diff UI + rollup tables for release readiness | When users ask for side-by-side plan comparisons or release readiness feels slow. |
