"""Integration tests for the MCP tools (SP3.3 + SP3.4).

Strategy: all HTTP calls are mocked with respx so no live server is required.
Each tool gets one happy-path test and one error-path test.

SP3.3 tools under test:
  create_run       — POST /api/projects/{slug}/runs
  list_runs        — GET  /api/projects/{slug}/runs
  get_run          — GET  /api/projects/{slug}/runs/{run_id}
  record_result    — POST /api/projects/{slug}/runs/{run_id}/results (single + batch)
  attach_evidence  — POST /api/projects/{slug}/runs/{run_id}/results/{case_id}/evidence
  close_run        — POST /api/projects/{slug}/runs/{run_id}/close

SP3.4 tools under test:
  save_plan            — POST /api/{slug}/proposals  (kind=plan)
  save_suite           — POST /api/{slug}/proposals  (kind=suite)
  resolve_plan         — POST /api/{slug}/content/resolve  OR  GET /api/{slug}/plans/{wid}/resolve
  get_dashboard_widget — GET  /api/{slug}/dashboards/widget/{widget_slug}
"""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime

import httpx
import pytest
import respx

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_BASE_URL = "http://localhost:8000"
_PROJECT = "acme"
_RUN_ID = "11111111-1111-1111-1111-111111111111"
_CASE_ID = "TC-LOGIN-001"
_NOW = datetime.now(UTC).isoformat()

# Minimal RunDetailOut payload returned by the API.
_RUN_DETAIL = {
    "data": {
        "id": _RUN_ID,
        "title": "Smoke run",
        "status": "open",
        "environment_id": None,
        "environment_name": None,
        "owner_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "created_at": _NOW,
        "updated_at": _NOW,
        "started_at": None,
        "closed_at": None,
        "closure_note": None,
        "counts": {"total": 1, "pass": 0, "fail": 0, "blocked": 0, "skipped": 0, "not_run": 1},
        "source": "manual",
        "parent_run_id": None,
        "assignees": [],
    }
}

_CLOSED_RUN_DETAIL = {
    **_RUN_DETAIL,
    "data": {
        **_RUN_DETAIL["data"],
        "status": "completed",
        "closed_at": _NOW,
        "closure_note": "All done",
    },
}


# ---------------------------------------------------------------------------
# Autouse fixture — set env vars for every test in this module
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def set_api_env(monkeypatch):
    """Wire WOMBAT_API_URL and WOMBAT_API_TOKEN for every test."""
    monkeypatch.setenv("WOMBAT_API_URL", _BASE_URL)
    monkeypatch.setenv("WOMBAT_API_TOKEN", "test-token")


# ---------------------------------------------------------------------------
# Registry count tests — SP3.3 adds 6 tools (25 → 31)
# ---------------------------------------------------------------------------


def test_sp33_tools_registered_in_api_mode():
    """All 6 SP3.3 tools are present in api mode."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")
    names = {t.name for t in registry.tool_definitions()}

    sp33_names = {"create_run", "list_runs", "get_run", "record_result", "attach_evidence", "close_run"}
    missing = sp33_names - names
    assert not missing, f"Missing SP3.3 tools: {missing}"


def test_sp34_tools_registered_in_api_mode():
    """All 4 SP3.4 tools are present in api mode."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")
    names = {t.name for t in registry.tool_definitions()}

    sp34_names = {"save_plan", "save_suite", "resolve_plan", "get_dashboard_widget"}
    missing = sp34_names - names
    assert not missing, f"Missing SP3.4 tools: {missing}"


def test_api_mode_has_30_tools():
    """API mode has 30 tools after SP3.3 + SP3.4 additions."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")
    tools = registry.tool_definitions()
    assert len(tools) == 30, f"Expected 30, got {len(tools)}: {[t.name for t in tools]}"


def test_both_mode_has_35_tools():
    """Both mode has 35 tools after SP3.3 + SP3.4 additions."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("both")
    tools = registry.tool_definitions()
    assert len(tools) == 35, f"Expected 35, got {len(tools)}: {[t.name for t in tools]}"


# ---------------------------------------------------------------------------
# create_run
# ---------------------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_create_run_happy_path():
    """create_run POSTs to /runs and returns the run detail."""
    from wombat_mcp.tools.api import _sp33_create_run

    route = respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs").mock(
        return_value=httpx.Response(201, json=_RUN_DETAIL)
    )

    result = await _sp33_create_run(
        {
            "project": _PROJECT,
            "title": "Smoke run",
            "case_selection": {"case_ids": [_CASE_ID]},
        }
    )

    assert route.called
    req = json.loads(route.calls[0].request.content)
    assert req["title"] == "Smoke run"
    assert req["case_selection"] == {"case_ids": [_CASE_ID]}
    assert req["source"] == "manual"
    assert result["data"]["title"] == "Smoke run"
    assert result["data"]["status"] == "open"


@respx.mock
@pytest.mark.asyncio
async def test_create_run_with_environment():
    """create_run forwards environment_id when provided."""
    from wombat_mcp.tools.api import _sp33_create_run

    env_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    route = respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs").mock(
        return_value=httpx.Response(201, json=_RUN_DETAIL)
    )

    await _sp33_create_run(
        {
            "project": _PROJECT,
            "title": "Env run",
            "environment_id": env_id,
            "case_selection": {"case_ids": [_CASE_ID]},
            "source": "ci",
        }
    )

    req = json.loads(route.calls[0].request.content)
    assert req["environment_id"] == env_id
    assert req["source"] == "ci"


@respx.mock
@pytest.mark.asyncio
async def test_create_run_error_propagates():
    """create_run raises on 4xx from the server."""
    from wombat_mcp.tools.api import _sp33_create_run

    respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs").mock(
        return_value=httpx.Response(
            422,
            json={"error": {"code": "validation_error", "message": "case_ids is empty"}},
        )
    )

    with pytest.raises(httpx.HTTPStatusError):
        await _sp33_create_run(
            {
                "project": _PROJECT,
                "title": "Bad run",
                "case_selection": {"case_ids": []},
            }
        )


# ---------------------------------------------------------------------------
# list_runs
# ---------------------------------------------------------------------------

_RUNS_LIST_RESPONSE = {
    "data": [
        {
            "id": _RUN_ID,
            "title": "Smoke run",
            "status": "open",
            "environment_id": None,
            "environment_name": None,
            "owner_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "created_at": _NOW,
            "updated_at": _NOW,
            "counts": {"total": 1, "pass": 0, "fail": 0, "blocked": 0, "skipped": 0, "not_run": 1},
            "source": "manual",
            "parent_run_id": None,
        }
    ],
    "next_cursor": None,
}


@respx.mock
@pytest.mark.asyncio
async def test_list_runs_happy_path():
    """list_runs GETs /runs and returns the list payload."""
    from wombat_mcp.tools.api import _sp33_list_runs

    route = respx.get(f"{_BASE_URL}/api/projects/{_PROJECT}/runs").mock(
        return_value=httpx.Response(200, json=_RUNS_LIST_RESPONSE)
    )

    result = await _sp33_list_runs({"project": _PROJECT})

    assert route.called
    assert len(result["data"]) == 1
    assert result["data"][0]["status"] == "open"


@respx.mock
@pytest.mark.asyncio
async def test_list_runs_filters_by_status():
    """list_runs passes status filter as a query param."""
    from wombat_mcp.tools.api import _sp33_list_runs

    route = respx.get(f"{_BASE_URL}/api/projects/{_PROJECT}/runs").mock(
        return_value=httpx.Response(
            200,
            json={"data": [], "next_cursor": None},
        )
    )

    await _sp33_list_runs({"project": _PROJECT, "status": "completed", "limit": 10})

    assert route.called
    url_str = str(route.calls[0].request.url)
    assert "status=completed" in url_str
    assert "limit=10" in url_str


@respx.mock
@pytest.mark.asyncio
async def test_list_runs_error_propagates():
    """list_runs raises on 403 from the server."""
    from wombat_mcp.tools.api import _sp33_list_runs

    respx.get(f"{_BASE_URL}/api/projects/{_PROJECT}/runs").mock(
        return_value=httpx.Response(403, json={"error": {"code": "forbidden"}})
    )

    with pytest.raises(httpx.HTTPStatusError):
        await _sp33_list_runs({"project": _PROJECT})


# ---------------------------------------------------------------------------
# get_run
# ---------------------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_get_run_happy_path():
    """get_run GETs /runs/{run_id} and returns counts."""
    from wombat_mcp.tools.api import _sp33_get_run

    route = respx.get(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}").mock(
        return_value=httpx.Response(200, json=_RUN_DETAIL)
    )

    result = await _sp33_get_run({"project": _PROJECT, "run_id": _RUN_ID})

    assert route.called
    data = result["data"]
    assert data["id"] == _RUN_ID
    # Counts are present
    assert "counts" in data
    counts = data["counts"]
    assert "total" in counts
    assert "not_run" in counts


@respx.mock
@pytest.mark.asyncio
async def test_get_run_not_found():
    """get_run raises on 404."""
    from wombat_mcp.tools.api import _sp33_get_run

    respx.get(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}").mock(
        return_value=httpx.Response(404, json={"error": {"code": "run_not_found"}})
    )

    with pytest.raises(httpx.HTTPStatusError):
        await _sp33_get_run({"project": _PROJECT, "run_id": _RUN_ID})


# ---------------------------------------------------------------------------
# record_result
# ---------------------------------------------------------------------------

_BATCH_RESPONSE = {"results": [{"case_id": _CASE_ID, "ok": True, "revision": 1, "error": None}]}


@respx.mock
@pytest.mark.asyncio
async def test_record_result_single_dict():
    """record_result wraps a single dict into a list and POSTs it."""
    from wombat_mcp.tools.api import _sp33_record_result

    route = respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results").mock(
        return_value=httpx.Response(200, json=_BATCH_RESPONSE)
    )

    result = await _sp33_record_result(
        {
            "project": _PROJECT,
            "run_id": _RUN_ID,
            "items": {"case_id": _CASE_ID, "status": "pass"},
        }
    )

    assert route.called
    body = json.loads(route.calls[0].request.content)
    # Server receives a list, not a bare dict.
    assert isinstance(body, list)
    assert len(body) == 1
    assert body[0]["case_id"] == _CASE_ID
    assert body[0]["status"] == "pass"
    assert result["results"][0]["ok"] is True


@respx.mock
@pytest.mark.asyncio
async def test_record_result_batch_list():
    """record_result passes a list directly to the server."""
    from wombat_mcp.tools.api import _sp33_record_result

    batch_response = {
        "results": [
            {"case_id": "TC-001", "ok": True, "revision": 1, "error": None},
            {"case_id": "TC-002", "ok": True, "revision": 1, "error": None},
        ]
    }
    route = respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results").mock(
        return_value=httpx.Response(200, json=batch_response)
    )

    result = await _sp33_record_result(
        {
            "project": _PROJECT,
            "run_id": _RUN_ID,
            "items": [
                {"case_id": "TC-001", "status": "pass"},
                {"case_id": "TC-002", "status": "fail", "notes": "Button missing"},
            ],
        }
    )

    assert route.called
    body = json.loads(route.calls[0].request.content)
    assert isinstance(body, list)
    assert len(body) == 2
    assert len(result["results"]) == 2


@respx.mock
@pytest.mark.asyncio
async def test_record_result_run_closed_error():
    """record_result surfaces the run_closed error from the server."""
    from wombat_mcp.tools.api import _sp33_record_result

    respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results").mock(
        return_value=httpx.Response(403, json={"error": {"code": "run_closed", "message": "Run is closed."}})
    )

    with pytest.raises(httpx.HTTPStatusError):
        await _sp33_record_result(
            {
                "project": _PROJECT,
                "run_id": _RUN_ID,
                "items": {"case_id": _CASE_ID, "status": "pass"},
            }
        )


# ---------------------------------------------------------------------------
# attach_evidence
# ---------------------------------------------------------------------------

_EVIDENCE_RESPONSE = {
    "data": {
        "id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
        "filename": "screenshot.png",
        "mime_type": "image/png",
        "size_bytes": 128,
        "uploaded_by": {
            "principal_type": "user",
            "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "display_name": "Tester",
        },
        "uploaded_at": _NOW,
    }
}


@respx.mock
@pytest.mark.asyncio
async def test_attach_evidence_happy_path():
    """attach_evidence decodes base64 and POSTs multipart to the evidence endpoint."""
    from wombat_mcp.tools.api import _sp33_attach_evidence

    # 128 bytes of fake PNG data
    raw = b"\x89PNG" + b"\x00" * 124
    b64 = base64.b64encode(raw).decode()

    url = f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results/{_CASE_ID}/evidence"
    route = respx.post(url).mock(return_value=httpx.Response(201, json=_EVIDENCE_RESPONSE))

    result = await _sp33_attach_evidence(
        {
            "project": _PROJECT,
            "run_id": _RUN_ID,
            "case_id": _CASE_ID,
            "filename": "screenshot.png",
            "mime_type": "image/png",
            "base64_content": b64,
        }
    )

    assert route.called
    # Verify it is a multipart request (Content-Type header contains boundary)
    ct = route.calls[0].request.headers.get("content-type", "")
    assert "multipart" in ct
    data = result["data"]
    assert data["filename"] == "screenshot.png"
    assert data["mime_type"] == "image/png"


@respx.mock
@pytest.mark.asyncio
async def test_attach_evidence_with_caption():
    """attach_evidence forwards optional caption."""
    from wombat_mcp.tools.api import _sp33_attach_evidence

    raw = b"fake image data"
    b64 = base64.b64encode(raw).decode()

    url = f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results/{_CASE_ID}/evidence"
    respx.post(url).mock(return_value=httpx.Response(201, json=_EVIDENCE_RESPONSE))

    # Should not raise even when caption is provided
    result = await _sp33_attach_evidence(
        {
            "project": _PROJECT,
            "run_id": _RUN_ID,
            "case_id": _CASE_ID,
            "filename": "notes.txt",
            "mime_type": "text/plain",
            "base64_content": b64,
            "caption": "Step 3 failed here",
        }
    )

    assert result["data"]["filename"] == "screenshot.png"  # mocked response


@pytest.mark.asyncio
async def test_attach_evidence_rejects_invalid_base64():
    """attach_evidence raises ValueError for malformed base64."""
    from wombat_mcp.tools.api import _sp33_attach_evidence

    with pytest.raises(ValueError, match="base64"):
        await _sp33_attach_evidence(
            {
                "project": _PROJECT,
                "run_id": _RUN_ID,
                "case_id": _CASE_ID,
                "filename": "file.bin",
                "mime_type": "application/octet-stream",
                "base64_content": "THIS IS NOT VALID BASE64 !!!",
            }
        )


@pytest.mark.asyncio
async def test_attach_evidence_rejects_oversized_file():
    """attach_evidence raises ValueError when decoded content exceeds 25 MB."""
    from wombat_mcp.tools.api import _sp33_attach_evidence

    # 26 MB of zeros
    oversized = b"\x00" * (26 * 1_048_576)
    b64 = base64.b64encode(oversized).decode()

    with pytest.raises(ValueError, match="25 MB"):
        await _sp33_attach_evidence(
            {
                "project": _PROJECT,
                "run_id": _RUN_ID,
                "case_id": _CASE_ID,
                "filename": "huge.bin",
                "mime_type": "application/octet-stream",
                "base64_content": b64,
            }
        )


@respx.mock
@pytest.mark.asyncio
async def test_attach_evidence_no_result_error():
    """attach_evidence surfaces the no_result error from the server."""
    from wombat_mcp.tools.api import _sp33_attach_evidence

    raw = b"small file"
    b64 = base64.b64encode(raw).decode()

    url = f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results/{_CASE_ID}/evidence"
    respx.post(url).mock(
        return_value=httpx.Response(
            422,
            json={"error": {"code": "no_result", "message": "Record a result before attaching evidence."}},
        )
    )

    with pytest.raises(httpx.HTTPStatusError):
        await _sp33_attach_evidence(
            {
                "project": _PROJECT,
                "run_id": _RUN_ID,
                "case_id": _CASE_ID,
                "filename": "shot.png",
                "mime_type": "image/png",
                "base64_content": b64,
            }
        )


# ---------------------------------------------------------------------------
# close_run
# ---------------------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_close_run_happy_path():
    """close_run POSTs to /close with reason and optional note."""
    from wombat_mcp.tools.api import _sp33_close_run

    route = respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/close").mock(
        return_value=httpx.Response(200, json=_CLOSED_RUN_DETAIL)
    )

    result = await _sp33_close_run(
        {
            "project": _PROJECT,
            "run_id": _RUN_ID,
            "reason": "completed",
            "note": "All done",
        }
    )

    assert route.called
    req = json.loads(route.calls[0].request.content)
    assert req["reason"] == "completed"
    assert req["note"] == "All done"
    assert result["data"]["status"] == "completed"
    assert result["data"]["closed_at"] is not None


@respx.mock
@pytest.mark.asyncio
async def test_close_run_without_note():
    """close_run works without a note."""
    from wombat_mcp.tools.api import _sp33_close_run

    route = respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/close").mock(
        return_value=httpx.Response(200, json=_CLOSED_RUN_DETAIL)
    )

    await _sp33_close_run(
        {
            "project": _PROJECT,
            "run_id": _RUN_ID,
            "reason": "aborted",
        }
    )

    req = json.loads(route.calls[0].request.content)
    assert req["reason"] == "aborted"
    assert "note" not in req


@respx.mock
@pytest.mark.asyncio
async def test_close_run_already_closed_error():
    """close_run surfaces the run_closed error from the server (already closed)."""
    from wombat_mcp.tools.api import _sp33_close_run

    respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/close").mock(
        return_value=httpx.Response(
            409,
            json={"error": {"code": "run_closed", "message": "Run is already closed."}},
        )
    )

    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        await _sp33_close_run(
            {
                "project": _PROJECT,
                "run_id": _RUN_ID,
                "reason": "completed",
            }
        )

    assert exc_info.value.response.status_code == 409


# ---------------------------------------------------------------------------
# ToolRegistry dispatch — exercise tools via the registry
# ---------------------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_registry_dispatches_create_run():
    """ToolRegistry.call correctly dispatches 'create_run'."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")

    respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs").mock(return_value=httpx.Response(201, json=_RUN_DETAIL))

    result = await registry.call(
        "create_run",
        {
            "project": _PROJECT,
            "title": "Agent run",
            "case_selection": {"case_ids": [_CASE_ID]},
        },
    )

    assert isinstance(result, dict)
    assert result["data"]["title"] == "Smoke run"


@respx.mock
@pytest.mark.asyncio
async def test_registry_dispatches_record_result():
    """ToolRegistry.call correctly dispatches 'record_result' (single item)."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")

    respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results").mock(
        return_value=httpx.Response(200, json=_BATCH_RESPONSE)
    )

    result = await registry.call(
        "record_result",
        {
            "project": _PROJECT,
            "run_id": _RUN_ID,
            "items": {"case_id": _CASE_ID, "status": "fail", "notes": "Button broken"},
        },
    )

    assert result["results"][0]["case_id"] == _CASE_ID


@respx.mock
@pytest.mark.asyncio
async def test_registry_dispatches_close_run():
    """ToolRegistry.call correctly dispatches 'close_run'."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")

    respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/close").mock(
        return_value=httpx.Response(200, json=_CLOSED_RUN_DETAIL)
    )

    result = await registry.call(
        "close_run",
        {
            "project": _PROJECT,
            "run_id": _RUN_ID,
            "reason": "completed",
        },
    )

    assert result["data"]["status"] == "completed"


# ---------------------------------------------------------------------------
# MCP Server error-envelope tests (Task 33)
#
# These tests exercise the full MCP Server call_tool handler path to verify
# that 4xx REST errors are surfaced as isError=True CallToolResult envelopes
# rather than protocol-level exceptions.  One test per SP3.3 tool.
# ---------------------------------------------------------------------------


def _make_call_tool_request(name: str, arguments: dict):  # -> mcp.types.CallToolRequest
    import mcp.types as t  # local import keeps top-level namespace clean

    return t.CallToolRequest(params=t.CallToolRequestParams(name=name, arguments=arguments))


@respx.mock
@pytest.mark.asyncio
async def test_server_create_run_error_envelope():
    """MCP server wraps create_run 422 into isError=True CallToolResult."""
    import mcp.types as t

    from wombat_mcp.main import create_server

    server = create_server()
    handler = server.request_handlers[t.CallToolRequest]

    respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs").mock(
        return_value=httpx.Response(
            422,
            json={"error": {"code": "validation_error", "message": "case_ids is empty"}},
        )
    )

    req = _make_call_tool_request(
        "create_run",
        {"project": _PROJECT, "title": "Bad run", "case_selection": {"case_ids": []}},
    )
    result = await handler(req)

    assert result.root.isError is True
    error_text = result.root.content[0].text
    assert "422" in error_text or "Unprocessable" in error_text


@respx.mock
@pytest.mark.asyncio
async def test_server_list_runs_error_envelope():
    """MCP server wraps list_runs 403 into isError=True CallToolResult."""
    import mcp.types as t

    from wombat_mcp.main import create_server

    server = create_server()
    handler = server.request_handlers[t.CallToolRequest]

    respx.get(f"{_BASE_URL}/api/projects/{_PROJECT}/runs").mock(
        return_value=httpx.Response(403, json={"error": {"code": "forbidden"}})
    )

    req = _make_call_tool_request("list_runs", {"project": _PROJECT})
    result = await handler(req)

    assert result.root.isError is True
    assert "403" in result.root.content[0].text or "Forbidden" in result.root.content[0].text


@respx.mock
@pytest.mark.asyncio
async def test_server_get_run_error_envelope():
    """MCP server wraps get_run 404 into isError=True CallToolResult."""
    import mcp.types as t

    from wombat_mcp.main import create_server

    server = create_server()
    handler = server.request_handlers[t.CallToolRequest]

    respx.get(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}").mock(
        return_value=httpx.Response(404, json={"error": {"code": "run_not_found"}})
    )

    req = _make_call_tool_request("get_run", {"project": _PROJECT, "run_id": _RUN_ID})
    result = await handler(req)

    assert result.root.isError is True
    assert "404" in result.root.content[0].text or "Not Found" in result.root.content[0].text


@respx.mock
@pytest.mark.asyncio
async def test_server_record_result_run_closed_error_envelope():
    """MCP server wraps record_result run_closed 403 into isError=True CallToolResult."""
    import mcp.types as t

    from wombat_mcp.main import create_server

    server = create_server()
    handler = server.request_handlers[t.CallToolRequest]

    respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results").mock(
        return_value=httpx.Response(
            403,
            json={"error": {"code": "run_closed", "message": "Run is closed."}},
        )
    )

    req = _make_call_tool_request(
        "record_result",
        {
            "project": _PROJECT,
            "run_id": _RUN_ID,
            "items": {"case_id": _CASE_ID, "status": "pass"},
        },
    )
    result = await handler(req)

    assert result.root.isError is True
    assert "403" in result.root.content[0].text or "Forbidden" in result.root.content[0].text


@respx.mock
@pytest.mark.asyncio
async def test_server_attach_evidence_no_result_error_envelope():
    """MCP server wraps attach_evidence 422 no_result into isError=True CallToolResult."""
    import base64 as _b64

    import mcp.types as t

    from wombat_mcp.main import create_server

    server = create_server()
    handler = server.request_handlers[t.CallToolRequest]

    url = f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results/{_CASE_ID}/evidence"
    respx.post(url).mock(
        return_value=httpx.Response(
            422,
            json={"error": {"code": "no_result", "message": "Record a result before attaching evidence."}},
        )
    )

    raw = b"small file"
    b64 = _b64.b64encode(raw).decode()

    req = _make_call_tool_request(
        "attach_evidence",
        {
            "project": _PROJECT,
            "run_id": _RUN_ID,
            "case_id": _CASE_ID,
            "filename": "shot.png",
            "mime_type": "image/png",
            "base64_content": b64,
        },
    )
    result = await handler(req)

    assert result.root.isError is True
    assert "422" in result.root.content[0].text or "Unprocessable" in result.root.content[0].text


@respx.mock
@pytest.mark.asyncio
async def test_server_close_run_already_closed_error_envelope():
    """MCP server wraps close_run 409 already-closed into isError=True CallToolResult.

    This is the canonical example from the Task 33 plan: 'close_run on already-closed
    returns the error envelope in the tool response'.
    """
    import mcp.types as t

    from wombat_mcp.main import create_server

    server = create_server()
    handler = server.request_handlers[t.CallToolRequest]

    respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/close").mock(
        return_value=httpx.Response(
            409,
            json={"error": {"code": "run_closed", "message": "Run is already closed."}},
        )
    )

    req = _make_call_tool_request(
        "close_run",
        {"project": _PROJECT, "run_id": _RUN_ID, "reason": "completed"},
    )
    result = await handler(req)

    assert result.root.isError is True
    # Error text contains the HTTP status code
    error_text = result.root.content[0].text
    assert "409" in error_text or "Conflict" in error_text


# ---------------------------------------------------------------------------
# SP3.4 planning + dashboards tools (Task 18)
# ---------------------------------------------------------------------------

_PLAN_WID = "PLAN-PAYMENTS-001"
_SUITE_WID = "SUITE-CHECKOUT-001"
_ENV_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd"
_ENV_NAME = "staging"

_PROPOSAL_RESPONSE = {
    "data": {
        "id": "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
        "kind": "plan",
        "wombat_id": _PLAN_WID,
        "status": "open",
        "created_at": _NOW,
        "updated_at": _NOW,
    }
}

_RESOLVED_PLAN_RESPONSE = {
    "data": {
        "cases": [
            {"wombat_id": "TC-PAY-001", "title": "Checkout happy path"},
            {"wombat_id": "TC-PAY-002", "title": "Payment decline"},
        ],
        "count": 2,
        "by_source": {"filter": 1, "explicit": 1, "suite": 0},
        "warnings": [],
    }
}

_WIDGET_PASSFAIL_RESPONSE = {
    "data": {
        "slug": "passfail_trend",
        "title": "Pass/Fail Trend",
        "rows": [
            {"date": "2026-04-15", "pass": 10, "fail": 2, "blocked": 0, "skipped": 1},
            {"date": "2026-04-16", "pass": 12, "fail": 1, "blocked": 0, "skipped": 0},
        ],
    }
}

_ENVIRONMENTS_RESPONSE = {
    "data": [
        {"id": _ENV_ID, "name": _ENV_NAME, "created_at": _NOW},
    ]
}


# --- save_plan ---


@respx.mock
@pytest.mark.asyncio
async def test_save_plan_happy_path():
    """save_plan POSTs to /api/{slug}/proposals with kind=plan."""
    from wombat_mcp.tools.api import _sp34_save_plan

    route = respx.post(f"{_BASE_URL}/api/{_PROJECT}/proposals").mock(
        return_value=httpx.Response(201, json=_PROPOSAL_RESPONSE)
    )

    plan_body = {
        "id": _PLAN_WID,
        "title": "Payments regression — Release 2026.05",
        "include": {"tags": ["payments"], "priority": "P1"},
        "explicit_cases": {"add": [], "remove": []},
        "suite_refs": [],
    }

    result = await _sp34_save_plan(
        {
            "project_slug": _PROJECT,
            "plan_body": plan_body,
        }
    )

    assert route.called
    req = json.loads(route.calls[0].request.content)
    assert req["kind"] == "plan"
    assert req["wombat_id"] == _PLAN_WID
    assert req["body"] == plan_body
    assert "base_revision" not in req
    assert result["data"]["kind"] == "plan"
    assert result["data"]["wombat_id"] == _PLAN_WID


@respx.mock
@pytest.mark.asyncio
async def test_save_plan_with_base_revision():
    """save_plan forwards base_revision when updating an existing plan."""
    from wombat_mcp.tools.api import _sp34_save_plan

    route = respx.post(f"{_BASE_URL}/api/{_PROJECT}/proposals").mock(
        return_value=httpx.Response(201, json=_PROPOSAL_RESPONSE)
    )

    await _sp34_save_plan(
        {
            "project_slug": _PROJECT,
            "plan_body": {"id": _PLAN_WID, "title": "Updated plan"},
            "base_revision": "abc1234",
        }
    )

    req = json.loads(route.calls[0].request.content)
    assert req["base_revision"] == "abc1234"


@respx.mock
@pytest.mark.asyncio
async def test_save_plan_error_propagates():
    """save_plan raises on 4xx from the server."""
    from wombat_mcp.tools.api import _sp34_save_plan

    respx.post(f"{_BASE_URL}/api/{_PROJECT}/proposals").mock(
        return_value=httpx.Response(
            409,
            json={"error": {"code": "open_proposal_exists", "message": "An open proposal already exists."}},
        )
    )

    with pytest.raises(httpx.HTTPStatusError):
        await _sp34_save_plan(
            {
                "project_slug": _PROJECT,
                "plan_body": {"id": _PLAN_WID, "title": "Duplicate plan"},
            }
        )


# --- save_suite ---


@respx.mock
@pytest.mark.asyncio
async def test_save_suite_happy_path():
    """save_suite POSTs to /api/{slug}/proposals with kind=suite."""
    from wombat_mcp.tools.api import _sp34_save_suite

    suite_proposal = {
        **_PROPOSAL_RESPONSE,
        "data": {**_PROPOSAL_RESPONSE["data"], "kind": "suite", "wombat_id": _SUITE_WID},
    }
    route = respx.post(f"{_BASE_URL}/api/{_PROJECT}/proposals").mock(
        return_value=httpx.Response(201, json=suite_proposal)
    )

    suite_body = {
        "id": _SUITE_WID,
        "title": "Checkout regression",
        "parent_wombat_id": None,
        "cases": ["TC-PAY-001", "TC-PAY-002"],
    }

    result = await _sp34_save_suite(
        {
            "project_slug": _PROJECT,
            "suite_body": suite_body,
        }
    )

    assert route.called
    req = json.loads(route.calls[0].request.content)
    assert req["kind"] == "suite"
    assert req["wombat_id"] == _SUITE_WID
    assert req["body"] == suite_body
    assert result["data"]["kind"] == "suite"


@respx.mock
@pytest.mark.asyncio
async def test_save_suite_with_base_revision():
    """save_suite forwards base_revision when updating an existing suite."""
    from wombat_mcp.tools.api import _sp34_save_suite

    route = respx.post(f"{_BASE_URL}/api/{_PROJECT}/proposals").mock(
        return_value=httpx.Response(201, json=_PROPOSAL_RESPONSE)
    )

    await _sp34_save_suite(
        {
            "project_slug": _PROJECT,
            "suite_body": {"id": _SUITE_WID, "title": "Updated suite"},
            "base_revision": "def5678",
        }
    )

    req = json.loads(route.calls[0].request.content)
    assert req["base_revision"] == "def5678"
    assert req["kind"] == "suite"


# --- resolve_plan ---


@respx.mock
@pytest.mark.asyncio
async def test_resolve_plan_with_body():
    """resolve_plan POSTs to /content/resolve when plan_body is provided."""
    from wombat_mcp.tools.api import _sp34_resolve_plan

    route = respx.post(f"{_BASE_URL}/api/{_PROJECT}/content/resolve").mock(
        return_value=httpx.Response(200, json=_RESOLVED_PLAN_RESPONSE)
    )

    plan_body = {
        "id": _PLAN_WID,
        "title": "Draft plan",
        "include": {"tags": ["payments"]},
        "explicit_cases": {"add": ["TC-PAY-002"], "remove": []},
        "suite_refs": [],
    }

    result = await _sp34_resolve_plan(
        {
            "project_slug": _PROJECT,
            "plan_body": plan_body,
        }
    )

    assert route.called
    req = json.loads(route.calls[0].request.content)
    assert req["kind"] == "plan"
    assert req["body"] == plan_body
    assert result["data"]["count"] == 2
    assert len(result["data"]["cases"]) == 2


@respx.mock
@pytest.mark.asyncio
async def test_resolve_plan_with_wombat_id():
    """resolve_plan GETs /plans/{wid}/resolve when plan_wombat_id is provided."""
    from wombat_mcp.tools.api import _sp34_resolve_plan

    route = respx.get(f"{_BASE_URL}/api/{_PROJECT}/plans/{_PLAN_WID}/resolve").mock(
        return_value=httpx.Response(200, json=_RESOLVED_PLAN_RESPONSE)
    )

    result = await _sp34_resolve_plan(
        {
            "project_slug": _PROJECT,
            "plan_wombat_id": _PLAN_WID,
        }
    )

    assert route.called
    assert result["data"]["count"] == 2


@pytest.mark.asyncio
async def test_resolve_plan_neither_raises():
    """resolve_plan raises ValueError when neither plan_body nor plan_wombat_id is given."""
    from wombat_mcp.tools.api import _sp34_resolve_plan

    with pytest.raises(ValueError, match="required"):
        await _sp34_resolve_plan({"project_slug": _PROJECT})


@pytest.mark.asyncio
async def test_resolve_plan_both_raises():
    """resolve_plan raises ValueError when both plan_body and plan_wombat_id are given."""
    from wombat_mcp.tools.api import _sp34_resolve_plan

    with pytest.raises(ValueError, match="not both"):
        await _sp34_resolve_plan(
            {
                "project_slug": _PROJECT,
                "plan_body": {"id": _PLAN_WID, "title": "Draft"},
                "plan_wombat_id": _PLAN_WID,
            }
        )


@respx.mock
@pytest.mark.asyncio
async def test_resolve_plan_error_propagates():
    """resolve_plan raises on 4xx from the server."""
    from wombat_mcp.tools.api import _sp34_resolve_plan

    respx.post(f"{_BASE_URL}/api/{_PROJECT}/content/resolve").mock(
        return_value=httpx.Response(
            422,
            json={"error": {"code": "unknown_suite_ref", "message": "Suite SUITE-X not found."}},
        )
    )

    with pytest.raises(httpx.HTTPStatusError):
        await _sp34_resolve_plan(
            {
                "project_slug": _PROJECT,
                "plan_body": {"id": _PLAN_WID, "suite_refs": ["SUITE-X"]},
            }
        )


# --- get_dashboard_widget ---


@respx.mock
@pytest.mark.asyncio
async def test_get_dashboard_widget_happy_path():
    """get_dashboard_widget GETs the widget endpoint with scope params."""
    from wombat_mcp.tools.api import _sp34_get_dashboard_widget

    route = respx.get(f"{_BASE_URL}/api/{_PROJECT}/dashboards/widget/passfail_trend").mock(
        return_value=httpx.Response(200, json=_WIDGET_PASSFAIL_RESPONSE)
    )

    result = await _sp34_get_dashboard_widget(
        {
            "project_slug": _PROJECT,
            "widget_slug": "passfail_trend",
            "scope": "project",
            "scope_id": _PROJECT,
            "window": "30d",
        }
    )

    assert route.called
    url_str = str(route.calls[0].request.url)
    assert "scope=project" in url_str
    assert "window=30d" in url_str
    assert result["data"]["slug"] == "passfail_trend"
    assert len(result["data"]["rows"]) == 2


@respx.mock
@pytest.mark.asyncio
async def test_get_dashboard_widget_plan_scope():
    """get_dashboard_widget passes plan_wombat_id as plan_id query param."""
    from wombat_mcp.tools.api import _sp34_get_dashboard_widget

    route = respx.get(f"{_BASE_URL}/api/{_PROJECT}/dashboards/widget/release_readiness").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "slug": "release_readiness",
                    "plan_id": _PLAN_WID,
                    "executed_pct": 78,
                    "pass_pct": 91,
                }
            },
        )
    )

    result = await _sp34_get_dashboard_widget(
        {
            "project_slug": _PROJECT,
            "widget_slug": "release_readiness",
            "scope": "project",
            "scope_id": _PROJECT,
            "plan_wombat_id": _PLAN_WID,
        }
    )

    assert route.called
    url_str = str(route.calls[0].request.url)
    assert f"plan_id={_PLAN_WID}" in url_str
    assert result["data"]["executed_pct"] == 78


@respx.mock
@pytest.mark.asyncio
async def test_get_dashboard_widget_env_name_resolved():
    """get_dashboard_widget resolves env_name to env_id before calling the widget endpoint."""
    from wombat_mcp.tools.api import _sp34_get_dashboard_widget

    env_route = respx.get(f"{_BASE_URL}/api/{_PROJECT}/environments").mock(
        return_value=httpx.Response(200, json=_ENVIRONMENTS_RESPONSE)
    )
    widget_route = respx.get(f"{_BASE_URL}/api/{_PROJECT}/dashboards/widget/passfail_trend").mock(
        return_value=httpx.Response(200, json=_WIDGET_PASSFAIL_RESPONSE)
    )

    result = await _sp34_get_dashboard_widget(
        {
            "project_slug": _PROJECT,
            "widget_slug": "passfail_trend",
            "scope": "project",
            "scope_id": _PROJECT,
            "env_name": _ENV_NAME,
        }
    )

    # Environment lookup was made.
    assert env_route.called
    env_url = str(env_route.calls[0].request.url)
    assert f"name={_ENV_NAME}" in env_url

    # Widget request contains resolved env_id, not env_name.
    assert widget_route.called
    widget_url = str(widget_route.calls[0].request.url)
    assert f"env_id={_ENV_ID}" in widget_url
    assert "env_name" not in widget_url

    assert result["data"]["slug"] == "passfail_trend"


@respx.mock
@pytest.mark.asyncio
async def test_get_dashboard_widget_env_name_not_found():
    """get_dashboard_widget raises ValueError when env_name has no match."""
    from wombat_mcp.tools.api import _sp34_get_dashboard_widget

    respx.get(f"{_BASE_URL}/api/{_PROJECT}/environments").mock(
        return_value=httpx.Response(200, json={"data": []})
    )

    with pytest.raises(ValueError, match="no environment named"):
        await _sp34_get_dashboard_widget(
            {
                "project_slug": _PROJECT,
                "widget_slug": "passfail_trend",
                "scope": "project",
                "scope_id": _PROJECT,
                "env_name": "nonexistent-env",
            }
        )


@respx.mock
@pytest.mark.asyncio
async def test_get_dashboard_widget_error_propagates():
    """get_dashboard_widget raises on 4xx from the server."""
    from wombat_mcp.tools.api import _sp34_get_dashboard_widget

    respx.get(f"{_BASE_URL}/api/{_PROJECT}/dashboards/widget/release_readiness").mock(
        return_value=httpx.Response(
            400,
            json={"error": {"code": "WIDGET_MISSING_FILTER", "message": "plan_id is required for release_readiness on project scope."}},
        )
    )

    with pytest.raises(httpx.HTTPStatusError):
        await _sp34_get_dashboard_widget(
            {
                "project_slug": _PROJECT,
                "widget_slug": "release_readiness",
                "scope": "project",
                "scope_id": _PROJECT,
                # plan_wombat_id intentionally omitted to trigger the error
            }
        )


# --- Registry dispatch for SP3.4 tools ---


@respx.mock
@pytest.mark.asyncio
async def test_registry_dispatches_save_plan():
    """ToolRegistry.call correctly dispatches 'save_plan'."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")

    respx.post(f"{_BASE_URL}/api/{_PROJECT}/proposals").mock(
        return_value=httpx.Response(201, json=_PROPOSAL_RESPONSE)
    )

    result = await registry.call(
        "save_plan",
        {
            "project_slug": _PROJECT,
            "plan_body": {"id": _PLAN_WID, "title": "Regression plan"},
        },
    )

    assert isinstance(result, dict)
    assert result["data"]["wombat_id"] == _PLAN_WID


@respx.mock
@pytest.mark.asyncio
async def test_registry_dispatches_resolve_plan():
    """ToolRegistry.call correctly dispatches 'resolve_plan' (body variant)."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")

    respx.post(f"{_BASE_URL}/api/{_PROJECT}/content/resolve").mock(
        return_value=httpx.Response(200, json=_RESOLVED_PLAN_RESPONSE)
    )

    result = await registry.call(
        "resolve_plan",
        {
            "project_slug": _PROJECT,
            "plan_body": {"id": _PLAN_WID, "include": {"tags": ["payments"]}},
        },
    )

    assert result["data"]["count"] == 2


@respx.mock
@pytest.mark.asyncio
async def test_registry_dispatches_get_dashboard_widget():
    """ToolRegistry.call correctly dispatches 'get_dashboard_widget'."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")

    respx.get(f"{_BASE_URL}/api/{_PROJECT}/dashboards/widget/recent_runs").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": {
                    "slug": "recent_runs",
                    "runs": [],
                }
            },
        )
    )

    result = await registry.call(
        "get_dashboard_widget",
        {
            "project_slug": _PROJECT,
            "widget_slug": "recent_runs",
            "scope": "project",
        },
    )

    assert result["data"]["slug"] == "recent_runs"
