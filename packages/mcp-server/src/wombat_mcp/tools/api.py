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

  Run management:
  - ``api:runs.list``            GET /api/projects/{slug}/runs
  - ``api:runs.get``             GET /api/projects/{slug}/runs/{run_id}
  - ``api:runs.create``          POST /api/projects/{slug}/runs
  - ``api:runs.add_results``     POST /api/projects/{slug}/runs/{run_id}/results:bulk

  Operations:
  - ``api:sync``                 POST /api/projects/{slug}/sync
  - ``api:import_file``          POST /api/projects/{slug}/imports/upload

  RAG tools:
  - ``api:search_content``       POST /api/projects/{slug}/search
  - ``api:get_content``          GET  /api/projects/{slug}/content/{id}
  - ``api:find_related_testcases``  /search (semantic) or /content/{id}/related
  - ``api:list_sources``         GET  /api/projects/{slug}/sources
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
