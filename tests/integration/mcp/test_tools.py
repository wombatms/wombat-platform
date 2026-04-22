"""Integration tests for the 6 new SP3.3 MCP tools.

Strategy: all HTTP calls are mocked with respx so no live server is required.
Each tool gets one happy-path test and one error-path test.

Tools under test:
  create_run       — POST /api/projects/{slug}/runs
  list_runs        — GET  /api/projects/{slug}/runs
  get_run          — GET  /api/projects/{slug}/runs/{run_id}
  record_result    — POST /api/projects/{slug}/runs/{run_id}/results (single + batch)
  attach_evidence  — POST /api/projects/{slug}/runs/{run_id}/results/{case_id}/evidence
  close_run        — POST /api/projects/{slug}/runs/{run_id}/close
"""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone

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
_NOW = datetime.now(timezone.utc).isoformat()

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


def test_api_mode_has_26_tools():
    """API mode has 26 tools after SP3.3 additions."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")
    tools = registry.tool_definitions()
    assert len(tools) == 26, f"Expected 26, got {len(tools)}: {[t.name for t in tools]}"


def test_both_mode_has_31_tools():
    """Both mode has 31 tools after SP3.3 additions."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("both")
    tools = registry.tool_definitions()
    assert len(tools) == 31, f"Expected 31, got {len(tools)}: {[t.name for t in tools]}"


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

_BATCH_RESPONSE = {
    "results": [
        {"case_id": _CASE_ID, "ok": True, "revision": 1, "error": None}
    ]
}


@respx.mock
@pytest.mark.asyncio
async def test_record_result_single_dict():
    """record_result wraps a single dict into a list and POSTs it."""
    from wombat_mcp.tools.api import _sp33_record_result

    route = respx.post(
        f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results"
    ).mock(return_value=httpx.Response(200, json=_BATCH_RESPONSE))

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
    route = respx.post(
        f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results"
    ).mock(return_value=httpx.Response(200, json=batch_response))

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

    respx.post(
        f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results"
    ).mock(
        return_value=httpx.Response(
            403, json={"error": {"code": "run_closed", "message": "Run is closed."}}
        )
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

    route = respx.post(
        f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/close"
    ).mock(return_value=httpx.Response(200, json=_CLOSED_RUN_DETAIL))

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

    route = respx.post(
        f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/close"
    ).mock(return_value=httpx.Response(200, json=_CLOSED_RUN_DETAIL))

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

    respx.post(
        f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/close"
    ).mock(
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

    respx.post(f"{_BASE_URL}/api/projects/{_PROJECT}/runs").mock(
        return_value=httpx.Response(201, json=_RUN_DETAIL)
    )

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

    respx.post(
        f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/results"
    ).mock(return_value=httpx.Response(200, json=_BATCH_RESPONSE))

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

    respx.post(
        f"{_BASE_URL}/api/projects/{_PROJECT}/runs/{_RUN_ID}/close"
    ).mock(return_value=httpx.Response(200, json=_CLOSED_RUN_DETAIL))

    result = await registry.call(
        "close_run",
        {
            "project": _PROJECT,
            "run_id": _RUN_ID,
            "reason": "completed",
        },
    )

    assert result["data"]["status"] == "completed"
