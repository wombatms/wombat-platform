"""API-backed MCP tools.

These tools make HTTP calls to the Wombat API (using httpx) and require
WOMBAT_API_URL and WOMBAT_API_TOKEN to be set in the environment.

Tools registered:
  Content reads (entity routes):
  - ``api:testcases.list``       GET /api/projects/{slug}/testcases
  - ``api:testcases.get``        GET /api/projects/{slug}/testcases/{wombat_id}
  - ``api:plans.list``           GET /api/projects/{slug}/plans
  - ``api:plans.get``            GET /api/projects/{slug}/plans/{wombat_id}
  - ``api:stories.list``         GET /api/projects/{slug}/stories
  - ``api:stories.get``          GET /api/projects/{slug}/stories/{wombat_id}
  - ``api:suites.list``          GET /api/projects/{slug}/suites
  - ``api:suites.get``           GET /api/projects/{slug}/suites/{wombat_id}
  - ``api:shared_steps.list``    GET /api/projects/{slug}/shared-steps
  - ``api:shared_steps.get``     GET /api/projects/{slug}/shared-steps/{wombat_id}

  Run management (SP2):
  - ``api:runs.list``            GET /api/projects/{slug}/runs
  - ``api:runs.get``             GET /api/projects/{slug}/runs/{run_id}
  - ``api:runs.create``          POST /api/projects/{slug}/runs
  - ``api:runs.add_results``     POST /api/projects/{slug}/runs/{run_id}/results:bulk

  Execution tier (SP3.3):
  - ``create_run``               POST /api/projects/{slug}/runs
  - ``list_runs``                GET  /api/projects/{slug}/runs
  - ``get_run``                  GET  /api/projects/{slug}/runs/{run_id}
  - ``record_result``            POST /api/projects/{slug}/runs/{run_id}/results (single or batch)
  - ``attach_evidence``          POST /api/projects/{slug}/runs/{run_id}/results/{case_id}/evidence
  - ``close_run``                POST /api/projects/{slug}/runs/{run_id}/close

  Operations:
  - ``api:sync``                 POST /api/projects/{slug}/sync
  - ``api:import_file``          POST /api/projects/{slug}/imports/upload

  RAG tools:
  - ``api:search_content``       POST /api/projects/{slug}/search
  - ``api:get_content``          GET  /api/projects/{slug}/content/{id}
  - ``api:find_related_testcases``  /search (semantic) or /content/{id}/related
  - ``api:list_sources``         GET  /api/projects/{slug}/sources

  Planning + Dashboards (SP3.4):
  - ``save_plan``                POST /api/{slug}/proposals  (kind=plan)
  - ``save_suite``               POST /api/{slug}/proposals  (kind=suite)
  - ``resolve_plan``             POST /api/{slug}/content/resolve  OR  GET /api/{slug}/plans/{wid}/resolve
  - ``get_dashboard_widget``     GET  /api/{slug}/dashboards/widget/{widget_slug}
"""

from __future__ import annotations

import os

import httpx
import mcp.types as types

# ---------------------------------------------------------------------------
# Shared client factory
# ---------------------------------------------------------------------------


def _client() -> httpx.AsyncClient:
    base_url = os.environ.get("WOMBAT_API_URL", "http://localhost:8000")
    token = os.environ.get("WOMBAT_API_TOKEN", "")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return httpx.AsyncClient(base_url=base_url, headers=headers, timeout=30.0)


# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

_ENTITY_LIST_PROPS = {
    "project": {"type": "string", "description": "Project slug."},
    "limit": {"type": "integer", "default": 50},
    "offset": {"type": "integer", "default": 0},
    "tag": {
        "type": "array",
        "items": {"type": "string"},
        "description": "Filter by tags.",
    },
    "q": {"type": "string", "description": "Keyword search query."},
}

_ENTITY_GET_PROPS = {
    "project": {"type": "string", "description": "Project slug."},
    "wombat_id": {"type": "string", "description": "WombatID of the entity."},
}


def _list_tool(name: str, plural: str, description: str) -> types.Tool:
    return types.Tool(
        name=name,
        description=description,
        inputSchema={
            "type": "object",
            "properties": _ENTITY_LIST_PROPS,
            "required": ["project"],
        },
    )


def _get_tool(name: str, singular: str, description: str) -> types.Tool:
    return types.Tool(
        name=name,
        description=description,
        inputSchema={
            "type": "object",
            "properties": _ENTITY_GET_PROPS,
            "required": ["project", "wombat_id"],
        },
    )


_TOOLS: list[types.Tool] = [
    # --- testcases ---
    _list_tool("api:testcases.list", "testcases", "List test cases synced to a project."),
    _get_tool("api:testcases.get", "testcase", "Fetch a single test case by WombatID."),
    # --- plans ---
    _list_tool("api:plans.list", "plans", "List test plans synced to a project."),
    _get_tool("api:plans.get", "plan", "Fetch a single test plan by WombatID."),
    # --- stories ---
    _list_tool("api:stories.list", "stories", "List user stories synced to a project."),
    _get_tool("api:stories.get", "story", "Fetch a single story by WombatID."),
    # --- suites ---
    _list_tool("api:suites.list", "suites", "List test suites synced to a project."),
    _get_tool("api:suites.get", "suite", "Fetch a single test suite by WombatID."),
    # --- shared_steps ---
    _list_tool("api:shared_steps.list", "shared_steps", "List shared steps synced to a project."),
    _get_tool("api:shared_steps.get", "shared_step", "Fetch a single shared step by WombatID."),
    # --- runs ---
    types.Tool(
        name="api:runs.list",
        description="List test runs for a project.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "limit": {"type": "integer", "default": 50},
                "offset": {"type": "integer", "default": 0},
            },
            "required": ["project"],
        },
    ),
    types.Tool(
        name="api:runs.get",
        description="Get a single test run (with summary) by run ID.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "run_id": {"type": "string", "description": "UUID of the run."},
            },
            "required": ["project", "run_id"],
        },
    ),
    types.Tool(
        name="api:runs.create",
        description="Create a new test run.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "title": {"type": "string"},
                "plan_wombat_id": {"type": "string"},
                "environment": {"type": "string"},
                "source": {"type": "string"},
                "assignees": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["project", "title"],
        },
    ),
    types.Tool(
        name="api:runs.add_results",
        description="Add bulk execution results to an existing run.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "run_id": {"type": "string"},
                "results": {
                    "type": "array",
                    "description": "Array of result objects (testcase_id, status, notes, duration_ms).",
                    "items": {
                        "type": "object",
                        "properties": {
                            "testcase_id": {"type": "string"},
                            "status": {"type": "string", "enum": ["passed", "failed", "skipped", "blocked"]},
                            "notes": {"type": "string"},
                            "duration_ms": {"type": "integer"},
                        },
                        "required": ["testcase_id", "status"],
                    },
                },
            },
            "required": ["project", "run_id", "results"],
        },
    ),
    # --- SP3.3 execution tier (spec §7.1) ---
    types.Tool(
        name="create_run",
        description=(
            "Create a new test run for a project. Provide exactly one of case_ids or filter in case_selection."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string", "description": "Project slug."},
                "title": {"type": "string", "description": "Title of the run."},
                "environment_id": {
                    "type": "string",
                    "description": "UUID of the environment (optional).",
                },
                "case_selection": {
                    "type": "object",
                    "description": (
                        "Exactly one of 'case_ids' (list of wombat_ids) or 'filter' (dict of filter params)."
                    ),
                    "properties": {
                        "case_ids": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Explicit list of case wombat_ids.",
                        },
                        "filter": {
                            "type": "object",
                            "description": "Filter dict (same shape as Library filter).",
                        },
                    },
                },
                "source": {
                    "type": "string",
                    "default": "manual",
                    "description": "Origin label for this run (e.g. 'manual', 'ci', 'agent').",
                },
                "assignee_user_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "UUIDs of users to assign.",
                    "default": [],
                },
                "assignee_token_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "UUIDs of API tokens to assign.",
                    "default": [],
                },
            },
            "required": ["project", "title", "case_selection"],
        },
    ),
    types.Tool(
        name="list_runs",
        description="List test runs for a project with optional filters.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string", "description": "Project slug."},
                "status": {
                    "type": "string",
                    "enum": ["open", "completed", "aborted"],
                    "description": "Filter by run status.",
                },
                "environment_id": {
                    "type": "string",
                    "description": "UUID of environment to filter by.",
                },
                "owner_id": {
                    "type": "string",
                    "description": "UUID of owner user to filter by.",
                },
                "q": {"type": "string", "description": "Keyword search query."},
                "limit": {"type": "integer", "default": 50},
                "cursor": {"type": "string", "description": "Pagination cursor."},
            },
            "required": ["project"],
        },
    ),
    types.Tool(
        name="get_run",
        description="Get a test run with full detail including cases and result summary.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string", "description": "Project slug."},
                "run_id": {"type": "string", "description": "UUID of the run."},
            },
            "required": ["project", "run_id"],
        },
    ),
    types.Tool(
        name="record_result",
        description=(
            "Record one or more execution results on a run. "
            "Pass a single dict or a list of dicts. "
            "Each item needs: case_id (wombat_id of the run case), status (pass|fail|blocked|skipped). "
            "Optional: notes, failed_at_step, bug_links, duration_ms."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string", "description": "Project slug."},
                "run_id": {"type": "string", "description": "UUID of the run."},
                "items": {
                    "description": (
                        "A single result dict or a list of result dicts. "
                        "Each dict: {case_id, status, notes?, failed_at_step?, "
                        "bug_links?, duration_ms?}."
                    ),
                    "oneOf": [
                        {
                            "type": "object",
                            "properties": {
                                "case_id": {"type": "string"},
                                "status": {"type": "string", "enum": ["pass", "fail", "blocked", "skipped"]},
                                "notes": {"type": "string"},
                                "failed_at_step": {"type": "integer"},
                                "bug_links": {"type": "array", "items": {"type": "object"}},
                                "duration_ms": {"type": "integer"},
                            },
                            "required": ["case_id", "status"],
                        },
                        {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "case_id": {"type": "string"},
                                    "status": {"type": "string", "enum": ["pass", "fail", "blocked", "skipped"]},
                                    "notes": {"type": "string"},
                                    "failed_at_step": {"type": "integer"},
                                    "bug_links": {"type": "array", "items": {"type": "object"}},
                                    "duration_ms": {"type": "integer"},
                                },
                                "required": ["case_id", "status"],
                            },
                        },
                    ],
                },
            },
            "required": ["project", "run_id", "items"],
        },
    ),
    types.Tool(
        name="attach_evidence",
        description=(
            "Attach a file as evidence to a specific case result in a run. "
            "Provide base64-encoded file content. "
            "Maximum file size is 25 MB. "
            "A result must already exist for the case (record_result first)."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string", "description": "Project slug."},
                "run_id": {"type": "string", "description": "UUID of the run."},
                "case_id": {"type": "string", "description": "WombatID of the case."},
                "filename": {"type": "string", "description": "Original filename (e.g. 'screenshot.png')."},
                "mime_type": {"type": "string", "description": "MIME type (e.g. 'image/png')."},
                "base64_content": {
                    "type": "string",
                    "description": "Base64-encoded file content. Must be ≤25 MB decoded.",
                },
                "caption": {
                    "type": "string",
                    "description": "Optional descriptive caption for this evidence.",
                },
            },
            "required": ["project", "run_id", "case_id", "filename", "mime_type", "base64_content"],
        },
    ),
    types.Tool(
        name="close_run",
        description=(
            "Close a test run, marking it as completed or aborted. "
            "Closed runs are immutable — no further results or evidence can be added."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string", "description": "Project slug."},
                "run_id": {"type": "string", "description": "UUID of the run."},
                "reason": {
                    "type": "string",
                    "enum": ["completed", "aborted"],
                    "description": "Closure reason.",
                },
                "note": {
                    "type": "string",
                    "description": "Optional closure note.",
                },
            },
            "required": ["project", "run_id", "reason"],
        },
    ),
    # --- SP3.4 planning + dashboards (spec §5.6) ---
    types.Tool(
        name="save_plan",
        description=(
            "Save (create or update) a test plan by submitting it as a proposal. "
            "Returns the created proposal record. "
            "Plan body must contain an 'id' field (wombat_id). "
            "Provide base_revision (git SHA) to update an existing plan; omit for new plans."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "project_slug": {"type": "string", "description": "Project slug."},
                "plan_body": {
                    "type": "object",
                    "description": (
                        "Full plan body dict. Must include 'id' (wombat_id). "
                        "Other fields: title, include, exclude, suite_refs, "
                        "explicit_cases: {add, remove}."
                    ),
                },
                "base_revision": {
                    "type": "string",
                    "description": "Git SHA of the revision being edited (required for updates; omit for new plans).",
                },
            },
            "required": ["project_slug", "plan_body"],
        },
    ),
    types.Tool(
        name="save_suite",
        description=(
            "Save (create or update) a test suite by submitting it as a proposal. "
            "Returns the created proposal record. "
            "Suite body must contain an 'id' field (wombat_id). "
            "Provide base_revision (git SHA) to update an existing suite; omit for new suites."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "project_slug": {"type": "string", "description": "Project slug."},
                "suite_body": {
                    "type": "object",
                    "description": (
                        "Full suite body dict. Must include 'id' (wombat_id). "
                        "Other fields: title, parent_wombat_id, cases, include, exclude."
                    ),
                },
                "base_revision": {
                    "type": "string",
                    "description": "Git SHA of the revision being edited (required for updates; omit for new suites).",
                },
            },
            "required": ["project_slug", "suite_body"],
        },
    ),
    types.Tool(
        name="resolve_plan",
        description=(
            "Resolve a plan into its effective set of test cases. "
            "Provide exactly one of plan_body (for unsaved drafts) or plan_wombat_id (for saved plans). "
            "Returns ResolvedPlan: cases list, count, by_source breakdown, warnings."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "project_slug": {"type": "string", "description": "Project slug."},
                "plan_body": {
                    "type": "object",
                    "description": (
                        "Draft plan body to resolve (unsaved). "
                        "POSTs to /content/resolve for live preview."
                    ),
                },
                "plan_wombat_id": {
                    "type": "string",
                    "description": (
                        "WombatID of an already-saved plan. "
                        "GETs /plans/{wid}/resolve."
                    ),
                },
            },
            "required": ["project_slug"],
        },
    ),
    types.Tool(
        name="get_dashboard_widget",
        description=(
            "Fetch data for a single dashboard widget. "
            "scope must be 'project' or 'plan'. "
            "scope_id is the project slug (for project scope) or plan wombat_id (for plan scope). "
            "Use env_name to filter by environment name; the tool resolves it to an env_id automatically. "
            "plan_wombat_id is required by the 'release_readiness' widget when scope='project'."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "project_slug": {"type": "string", "description": "Project slug."},
                "widget_slug": {
                    "type": "string",
                    "enum": [
                        "passfail_trend",
                        "recent_runs",
                        "top_failing_cases",
                        "review_backlog",
                        "release_readiness",
                    ],
                    "description": "Slug of the widget to fetch.",
                },
                "scope": {
                    "type": "string",
                    "enum": ["project", "plan"],
                    "description": "Dashboard scope.",
                },
                "scope_id": {
                    "type": "string",
                    "description": "Project slug (project scope) or plan wombat_id (plan scope).",
                },
                "window": {
                    "type": "string",
                    "enum": ["7d", "30d", "90d", "all"],
                    "description": "Time window for trend-based widgets.",
                },
                "env_name": {
                    "type": "string",
                    "description": "Environment name to filter by. Resolved to env_id automatically.",
                },
                "plan_wombat_id": {
                    "type": "string",
                    "description": "Plan wombat_id filter (required for release_readiness on project scope).",
                },
            },
            "required": ["project_slug", "widget_slug", "scope"],
        },
    ),
    # --- sync / import ---
    types.Tool(
        name="api:sync",
        description="Trigger an index sync for a project.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "test_repo_path": {"type": "string", "default": "."},
                "app_repos": {"type": "array", "items": {"type": "object"}, "default": []},
                "docs_folder": {"type": "string"},
            },
            "required": ["project"],
        },
    ),
    types.Tool(
        name="api:import_file",
        description="Upload an XLSX or CSV file and return a raw parse summary.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "file_path": {"type": "string", "description": "Absolute local path to the file to upload."},
                "profile": {"type": "string", "default": "default"},
            },
            "required": ["project", "file_path"],
        },
    ),
    # --- RAG tools ---
    types.Tool(
        name="api:search_content",
        description=(
            "Semantic + hybrid search across all content indexed in a project. "
            "Use for 'find me tests/docs about X' queries."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "query": {"type": "string"},
                "kinds": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Filter by content kinds, e.g. ['testcase', 'doc'].",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Filter by tags (all must match).",
                },
                "top_k": {"type": "integer", "default": 10},
                "mode": {
                    "type": "string",
                    "enum": ["hybrid", "semantic", "keyword"],
                    "default": "hybrid",
                },
            },
            "required": ["project", "query"],
        },
    ),
    types.Tool(
        name="api:get_content",
        description="Fetch the full body for a content row by UUID or wombat_id.",
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "content_id": {
                    "type": "string",
                    "description": "Content UUID or WombatID (e.g. TC-LOGIN-001).",
                },
            },
            "required": ["project", "content_id"],
        },
    ),
    types.Tool(
        name="api:find_related_testcases",
        description=(
            "Find semantically similar test cases to avoid duplicate authoring. "
            "Provide exactly one of testcase_id (reuses stored embedding) or "
            "draft_text (embedded on the fly)."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "testcase_id": {
                    "type": "string",
                    "description": "Content UUID of the source test case.",
                },
                "draft_text": {
                    "type": "string",
                    "description": "Draft text to embed and search against.",
                },
                "top_k": {"type": "integer", "default": 5},
            },
            "required": ["project"],
        },
    ),
    types.Tool(
        name="api:list_sources",
        description=(
            "List configured RAG sources with last_synced_revision and "
            "last_synced_at per source. Use to reason about content freshness."
        ),
        inputSchema={
            "type": "object",
            "properties": {
                "project": {"type": "string"},
            },
            "required": ["project"],
        },
    ),
]


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def _entity_list(project: str, endpoint: str, args: dict) -> dict:
    params: dict[str, object] = {
        "limit": args.get("limit", 50),
        "offset": args.get("offset", 0),
    }
    if args.get("q"):
        params["q"] = args["q"]
    if args.get("tag"):
        params["tag"] = args["tag"]
    if args.get("component"):
        params["component"] = args["component"]
    async with _client() as c:
        r = await c.get(f"/api/projects/{project}/{endpoint}", params=params)
        r.raise_for_status()
        return r.json()


async def _entity_get(project: str, endpoint: str, wombat_id: str) -> dict:
    async with _client() as c:
        r = await c.get(f"/api/projects/{project}/{endpoint}/{wombat_id}")
        r.raise_for_status()
        return r.json()


_ENTITY_ENDPOINTS: dict[str, str] = {
    "testcases": "testcases",
    "plans": "plans",
    "stories": "stories",
    "suites": "suites",
    "shared_steps": "shared-steps",
}


async def _handle_list(kind: str, args: dict) -> dict:
    return await _entity_list(args["project"], _ENTITY_ENDPOINTS[kind], args)


async def _handle_get(kind: str, args: dict) -> dict:
    return await _entity_get(
        args["project"],
        _ENTITY_ENDPOINTS[kind],
        args["wombat_id"],
    )


async def _runs_list(args: dict) -> dict:
    params = {"limit": args.get("limit", 50), "offset": args.get("offset", 0)}
    async with _client() as c:
        r = await c.get(f"/api/projects/{args['project']}/runs", params=params)
        r.raise_for_status()
        return r.json()


async def _runs_get(args: dict) -> dict:
    async with _client() as c:
        r = await c.get(f"/api/projects/{args['project']}/runs/{args['run_id']}")
        r.raise_for_status()
        return r.json()


async def _runs_create(args: dict) -> dict:
    body = {k: v for k, v in args.items() if k != "project"}
    async with _client() as c:
        r = await c.post(f"/api/projects/{args['project']}/runs", json=body)
        r.raise_for_status()
        return r.json()


async def _runs_add_results(args: dict) -> dict:
    async with _client() as c:
        r = await c.post(
            f"/api/projects/{args['project']}/runs/{args['run_id']}/results:bulk",
            json=args["results"],
        )
        r.raise_for_status()
        return r.json()


async def _sync(args: dict) -> dict:
    body = {
        "test_repo_path": args.get("test_repo_path", "."),
        "app_repos": args.get("app_repos", []),
        "docs_folder": args.get("docs_folder"),
    }
    async with _client() as c:
        r = await c.post(f"/api/projects/{args['project']}/sync", json=body)
        r.raise_for_status()
        return r.json()


async def _import_file(args: dict) -> dict:
    import pathlib

    file_path = pathlib.Path(args["file_path"])
    profile = args.get("profile", "default")
    async with _client() as c:
        with open(file_path, "rb") as fh:
            r = await c.post(
                f"/api/projects/{args['project']}/imports/upload",
                data={"profile": profile},
                files={"file": (file_path.name, fh)},
            )
        r.raise_for_status()
        return r.json()


async def _search_content(args: dict) -> dict:
    body = {
        "query": args["query"],
        "kinds": args.get("kinds"),
        "tags": args.get("tags"),
        "top_k": args.get("top_k", 10),
        "mode": args.get("mode", "hybrid"),
        "include_chunks": True,
    }
    async with _client() as c:
        r = await c.post(f"/api/projects/{args['project']}/search", json=body)
        r.raise_for_status()
        return r.json()


async def _get_content(args: dict) -> dict:
    content_id = args["content_id"]
    project = args["project"]
    async with _client() as c:
        r = await c.get(f"/api/projects/{project}/content/{content_id}")
        r.raise_for_status()
        return r.json()


async def _find_related_testcases(args: dict) -> dict:
    project = args["project"]
    testcase_id = args.get("testcase_id")
    draft_text = args.get("draft_text")
    top_k = args.get("top_k", 5)

    if (testcase_id is None) == (draft_text is None):
        raise ValueError("Provide exactly one of testcase_id or draft_text")

    async with _client() as c:
        if draft_text is not None:
            r = await c.post(
                f"/api/projects/{project}/search",
                json={
                    "query": draft_text,
                    "kinds": ["testcase"],
                    "top_k": top_k,
                    "mode": "semantic",
                    "include_chunks": False,
                },
            )
        else:
            r = await c.get(
                f"/api/projects/{project}/content/{testcase_id}/related",
                params={"top_k": top_k, "kind": "testcase"},
            )
        r.raise_for_status()
        return r.json()


async def _list_sources(args: dict) -> dict:
    async with _client() as c:
        r = await c.get(f"/api/projects/{args['project']}/sources")
        r.raise_for_status()
        return r.json()


# ---------------------------------------------------------------------------
# SP3.3 execution tier handlers (spec §7.1)
# ---------------------------------------------------------------------------

_MAX_EVIDENCE_BYTES = 25 * 1_048_576  # 25 MB


async def _sp33_create_run(args: dict) -> dict:
    """POST /api/projects/{slug}/runs — create a test run."""
    project = args["project"]
    body: dict = {
        "title": args["title"],
        "case_selection": args["case_selection"],
        "source": args.get("source", "manual"),
        "assignee_user_ids": args.get("assignee_user_ids", []),
        "assignee_token_ids": args.get("assignee_token_ids", []),
    }
    if args.get("environment_id") is not None:
        body["environment_id"] = args["environment_id"]
    async with _client() as c:
        r = await c.post(f"/api/projects/{project}/runs", json=body)
        r.raise_for_status()
        return r.json()


async def _sp33_list_runs(args: dict) -> dict:
    """GET /api/projects/{slug}/runs — list runs with filters."""
    project = args["project"]
    params: dict = {"limit": args.get("limit", 50)}
    for key in ("status", "environment_id", "owner_id", "q", "cursor"):
        if args.get(key) is not None:
            params[key] = args[key]
    async with _client() as c:
        r = await c.get(f"/api/projects/{project}/runs", params=params)
        r.raise_for_status()
        return r.json()


async def _sp33_get_run(args: dict) -> dict:
    """GET /api/projects/{slug}/runs/{run_id} — get run detail."""
    project = args["project"]
    run_id = args["run_id"]
    async with _client() as c:
        r = await c.get(f"/api/projects/{project}/runs/{run_id}")
        r.raise_for_status()
        return r.json()


async def _sp33_record_result(args: dict) -> dict:
    """POST /api/projects/{slug}/runs/{run_id}/results — single or batch.

    ``items`` may be a single dict or a list of dicts.  A single dict is
    promoted to a one-element list so the server always receives a list.
    """
    project = args["project"]
    run_id = args["run_id"]
    items = args["items"]
    if isinstance(items, dict):
        items = [items]
    async with _client() as c:
        r = await c.post(
            f"/api/projects/{project}/runs/{run_id}/results",
            json=items,
        )
        r.raise_for_status()
        return r.json()


async def _sp33_attach_evidence(args: dict) -> dict:
    """POST .../results/{case_id}/evidence — multipart upload from base64.

    Decodes ``base64_content`` and enforces the 25 MB cap before making the
    HTTP call so the caller gets a readable error rather than a 413 from the
    server.
    """
    import base64

    project = args["project"]
    run_id = args["run_id"]
    case_id = args["case_id"]
    filename = args["filename"]
    mime_type = args["mime_type"]
    b64 = args["base64_content"]
    caption = args.get("caption")

    # Decode and enforce size cap early (helpful error before any HTTP call).
    try:
        raw_bytes = base64.b64decode(b64, validate=True)
    except Exception as exc:
        raise ValueError(f"base64_content is not valid base64: {exc}") from exc

    if len(raw_bytes) > _MAX_EVIDENCE_BYTES:
        mb = len(raw_bytes) / 1_048_576
        raise ValueError(
            f"Evidence file is {mb:.1f} MB which exceeds the 25 MB limit. "
            "Upload large files directly via the REST evidence endpoint."
        )

    import io

    file_obj = io.BytesIO(raw_bytes)
    files = {"file": (filename, file_obj, mime_type)}
    data = {}
    if caption is not None:
        data["caption"] = caption

    async with _client() as c:
        r = await c.post(
            f"/api/projects/{project}/runs/{run_id}/results/{case_id}/evidence",
            files=files,
            data=data,
        )
        r.raise_for_status()
        return r.json()


async def _sp33_close_run(args: dict) -> dict:
    """POST /api/projects/{slug}/runs/{run_id}/close."""
    project = args["project"]
    run_id = args["run_id"]
    body: dict = {"reason": args["reason"]}
    if args.get("note") is not None:
        body["note"] = args["note"]
    async with _client() as c:
        r = await c.post(
            f"/api/projects/{project}/runs/{run_id}/close",
            json=body,
        )
        r.raise_for_status()
        return r.json()


# ---------------------------------------------------------------------------
# SP3.4 planning + dashboards handlers (spec §5.6)
# ---------------------------------------------------------------------------


async def _sp34_save_plan(args: dict) -> dict:
    """POST /api/{slug}/proposals with kind=plan.

    The plan body's own ``id`` field is used as the wombat_id.  This mirrors
    the file-format convention where the plan's WombatID lives in the body.
    """
    project = args["project_slug"]
    plan_body = args["plan_body"]
    wombat_id = plan_body.get("id")
    payload: dict = {
        "kind": "plan",
        "wombat_id": wombat_id,
        "body": plan_body,
    }
    if args.get("base_revision") is not None:
        payload["base_revision"] = args["base_revision"]
    async with _client() as c:
        r = await c.post(f"/api/{project}/proposals", json=payload)
        r.raise_for_status()
        return r.json()


async def _sp34_save_suite(args: dict) -> dict:
    """POST /api/{slug}/proposals with kind=suite.

    Mirrors ``_sp34_save_plan`` but for suites.
    """
    project = args["project_slug"]
    suite_body = args["suite_body"]
    wombat_id = suite_body.get("id")
    payload: dict = {
        "kind": "suite",
        "wombat_id": wombat_id,
        "body": suite_body,
    }
    if args.get("base_revision") is not None:
        payload["base_revision"] = args["base_revision"]
    async with _client() as c:
        r = await c.post(f"/api/{project}/proposals", json=payload)
        r.raise_for_status()
        return r.json()


async def _sp34_resolve_plan(args: dict) -> dict:
    """Resolve a plan into its effective set of test cases.

    Exactly one of ``plan_body`` (draft) or ``plan_wombat_id`` (saved plan)
    must be supplied:

    - ``plan_body``       → POST /api/{slug}/content/resolve  (live preview)
    - ``plan_wombat_id`` → GET  /api/{slug}/plans/{wid}/resolve
    """
    project = args["project_slug"]
    plan_body = args.get("plan_body")
    plan_wombat_id = args.get("plan_wombat_id")

    has_body = plan_body is not None
    has_wid = plan_wombat_id is not None

    if has_body == has_wid:
        # Both provided or neither provided.
        if has_body:
            raise ValueError(
                "resolve_plan: provide exactly one of plan_body or plan_wombat_id, not both."
            )
        raise ValueError(
            "resolve_plan: exactly one of plan_body or plan_wombat_id is required."
        )

    async with _client() as c:
        if has_body:
            r = await c.post(
                f"/api/{project}/content/resolve",
                json={"kind": "plan", "body": plan_body},
            )
        else:
            r = await c.get(f"/api/{project}/plans/{plan_wombat_id}/resolve")
        r.raise_for_status()
        return r.json()


async def _sp34_get_dashboard_widget(args: dict) -> dict:
    """GET /api/{slug}/dashboards/widget/{widget_slug} with mapped query params.

    If ``env_name`` is given, resolve it to an ``env_id`` by calling
    GET /api/{slug}/environments?name={env_name} first.  If no matching
    environment is found, a ValueError is raised so the agent can correct the
    name before retrying.

    ``plan_wombat_id`` is forwarded as the ``plan_id`` query param.
    """
    project = args["project_slug"]
    widget_slug = args["widget_slug"]
    scope = args["scope"]

    params: dict = {"scope": scope}
    if args.get("scope_id") is not None:
        params["scope_id"] = args["scope_id"]
    if args.get("window") is not None:
        params["window"] = args["window"]
    if args.get("plan_wombat_id") is not None:
        params["plan_id"] = args["plan_wombat_id"]

    env_name = args.get("env_name")
    if env_name is not None:
        # Resolve env_name → env_id via the environments list endpoint.
        async with _client() as c:
            env_r = await c.get(
                f"/api/{project}/environments",
                params={"name": env_name},
            )
            env_r.raise_for_status()
            env_payload = env_r.json()
            # Expect {data: [{id, name, ...}, ...]}
            envs = env_payload.get("data") or []
            match = next((e for e in envs if e.get("name") == env_name), None)
            if match is None:
                raise ValueError(
                    f"get_dashboard_widget: no environment named '{env_name}' in project '{project}'. "
                    "Check the name or omit env_name to fetch unfiltered data."
                )
            params["env_id"] = match["id"]

    async with _client() as c:
        r = await c.get(
            f"/api/{project}/dashboards/widget/{widget_slug}",
            params=params,
        )
        r.raise_for_status()
        return r.json()


# ---------------------------------------------------------------------------
# Dispatch table
# ---------------------------------------------------------------------------


async def _dispatch(name: str, args: dict) -> object:
    dispatch: dict[str, object] = {
        "api:testcases.list": lambda a: _handle_list("testcases", a),
        "api:testcases.get": lambda a: _handle_get("testcases", a),
        "api:plans.list": lambda a: _handle_list("plans", a),
        "api:plans.get": lambda a: _handle_get("plans", a),
        "api:stories.list": lambda a: _handle_list("stories", a),
        "api:stories.get": lambda a: _handle_get("stories", a),
        "api:suites.list": lambda a: _handle_list("suites", a),
        "api:suites.get": lambda a: _handle_get("suites", a),
        "api:shared_steps.list": lambda a: _handle_list("shared_steps", a),
        "api:shared_steps.get": lambda a: _handle_get("shared_steps", a),
        "api:runs.list": _runs_list,
        "api:runs.get": _runs_get,
        "api:runs.create": _runs_create,
        "api:runs.add_results": _runs_add_results,
        "api:sync": _sync,
        "api:import_file": _import_file,
        "api:search_content": _search_content,
        "api:get_content": _get_content,
        "api:find_related_testcases": _find_related_testcases,
        "api:list_sources": _list_sources,
        # SP3.3 execution tier
        "create_run": _sp33_create_run,
        "list_runs": _sp33_list_runs,
        "get_run": _sp33_get_run,
        "record_result": _sp33_record_result,
        "attach_evidence": _sp33_attach_evidence,
        "close_run": _sp33_close_run,
        # SP3.4 planning + dashboards
        "save_plan": _sp34_save_plan,
        "save_suite": _sp34_save_suite,
        "resolve_plan": _sp34_resolve_plan,
        "get_dashboard_widget": _sp34_get_dashboard_widget,
    }
    handler = dispatch.get(name)
    if handler is None:
        raise ValueError(f"Unknown API tool: {name!r}")
    return await handler(args)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


def register_api_tools(registry) -> None:  # noqa: ANN001
    """Register all API-backed tools into *registry*."""
    for tool in _TOOLS:
        tool_name = tool.name  # capture for closure

        async def _handler(args: dict, _name: str = tool_name) -> object:
            return await _dispatch(_name, args)

        registry.register(tool, _handler)
