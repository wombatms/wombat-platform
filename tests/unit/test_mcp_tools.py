"""Unit tests for MCP tool implementations.

Tests cover:
- search_content: correct POST body construction
- get_content: handles both UUID and wombat_id
- find_related_testcases: routes correctly for each input mode
- list_sources: parses the expected response shape

All API calls are mocked with respx so no live server is required.
"""

from __future__ import annotations

import json

import httpx
import pytest
import respx

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def set_api_env(monkeypatch):
    """Set API env vars for all tests in this module."""
    monkeypatch.setenv("WOMBAT_API_URL", "http://test-api")
    monkeypatch.setenv("WOMBAT_API_TOKEN", "test-token")


# ---------------------------------------------------------------------------
# search_content — correct POST body
# ---------------------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_search_content_minimal_body():
    """search_content sends the correct minimal POST body."""
    from wombat_mcp.tools.api import _search_content

    expected_response = {
        "hits": [{"id": "abc", "kind": "testcase", "title": "Login test", "score": 0.9}],
        "query": "login",
        "mode": "hybrid",
        "total_returned": 1,
    }
    route = respx.post("http://test-api/api/projects/myproject/search").mock(
        return_value=httpx.Response(200, json=expected_response)
    )

    result = await _search_content(
        {
            "project": "myproject",
            "query": "login",
        }
    )

    assert route.called
    sent = json.loads(route.calls[0].request.content)
    assert sent["query"] == "login"
    assert sent["mode"] == "hybrid"
    assert sent["top_k"] == 10
    assert sent["include_chunks"] is True
    assert sent["kinds"] is None
    assert sent["tags"] is None
    assert result["total_returned"] == 1


@respx.mock
@pytest.mark.asyncio
async def test_search_content_full_params():
    """search_content passes all optional params to the API."""
    from wombat_mcp.tools.api import _search_content

    route = respx.post("http://test-api/api/projects/proj/search").mock(
        return_value=httpx.Response(200, json={"hits": [], "query": "auth", "mode": "semantic", "total_returned": 0})
    )

    await _search_content(
        {
            "project": "proj",
            "query": "auth",
            "kinds": ["testcase"],
            "tags": ["regression"],
            "top_k": 5,
            "mode": "semantic",
        }
    )

    assert route.called
    sent = json.loads(route.calls[0].request.content)
    assert sent["kinds"] == ["testcase"]
    assert sent["tags"] == ["regression"]
    assert sent["top_k"] == 5
    assert sent["mode"] == "semantic"


# ---------------------------------------------------------------------------
# get_content — UUID vs wombat_id
# ---------------------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_get_content_by_uuid():
    """get_content calls /content/{uuid} for a UUID-shaped content_id."""
    from wombat_mcp.tools.api import _get_content

    content_uuid = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
    expected = {"data": {"id": content_uuid, "kind": "testcase", "title": "Test"}}
    route = respx.get(f"http://test-api/api/projects/proj/content/{content_uuid}").mock(
        return_value=httpx.Response(200, json=expected)
    )

    result = await _get_content({"project": "proj", "content_id": content_uuid})

    assert route.called
    assert result["data"]["id"] == content_uuid


@respx.mock
@pytest.mark.asyncio
async def test_get_content_by_wombat_id():
    """get_content calls /content/{wombat_id} for a WombatID-shaped content_id."""
    from wombat_mcp.tools.api import _get_content

    wombat_id = "TC-LOGIN-001"
    expected = {"data": {"id": "some-uuid", "wombat_id": wombat_id, "kind": "testcase"}}
    route = respx.get(f"http://test-api/api/projects/proj/content/{wombat_id}").mock(
        return_value=httpx.Response(200, json=expected)
    )

    result = await _get_content({"project": "proj", "content_id": wombat_id})

    assert route.called
    assert result["data"]["wombat_id"] == wombat_id


@respx.mock
@pytest.mark.asyncio
async def test_get_content_story_wombat_id():
    """get_content works with STORY- prefixed WombatIDs."""
    from wombat_mcp.tools.api import _get_content

    wombat_id = "STORY-AUTH-001"
    respx.get(f"http://test-api/api/projects/proj/content/{wombat_id}").mock(
        return_value=httpx.Response(200, json={"data": {"wombat_id": wombat_id}})
    )
    result = await _get_content({"project": "proj", "content_id": wombat_id})
    assert result["data"]["wombat_id"] == wombat_id


# ---------------------------------------------------------------------------
# find_related_testcases — routing logic
# ---------------------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_find_related_testcases_by_draft_text():
    """find_related_testcases with draft_text POSTs to /search with mode=semantic."""
    from wombat_mcp.tools.api import _find_related_testcases

    expected = {"hits": [], "query": "login form", "mode": "semantic", "total_returned": 0}
    route = respx.post("http://test-api/api/projects/proj/search").mock(return_value=httpx.Response(200, json=expected))

    result = await _find_related_testcases(
        {
            "project": "proj",
            "draft_text": "login form with invalid credentials",
            "top_k": 3,
        }
    )

    assert route.called
    sent = json.loads(route.calls[0].request.content)
    assert sent["query"] == "login form with invalid credentials"
    assert sent["kinds"] == ["testcase"]
    assert sent["mode"] == "semantic"
    assert sent["top_k"] == 3
    assert sent["include_chunks"] is False


@respx.mock
@pytest.mark.asyncio
async def test_find_related_testcases_by_testcase_id():
    """find_related_testcases with testcase_id GETs /content/{id}/related."""
    from wombat_mcp.tools.api import _find_related_testcases

    tc_id = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
    expected = {"hits": [], "source_id": tc_id, "total_returned": 0}
    route = respx.get(f"http://test-api/api/projects/proj/content/{tc_id}/related").mock(
        return_value=httpx.Response(200, json=expected)
    )

    result = await _find_related_testcases(
        {
            "project": "proj",
            "testcase_id": tc_id,
            "top_k": 5,
        }
    )

    assert route.called
    # Verify top_k was passed as a query param
    assert "top_k=5" in str(route.calls[0].request.url)
    assert result["source_id"] == tc_id


@pytest.mark.asyncio
async def test_find_related_testcases_requires_exactly_one():
    """find_related_testcases raises if both or neither input is provided."""
    from wombat_mcp.tools.api import _find_related_testcases

    with pytest.raises(ValueError, match="exactly one"):
        await _find_related_testcases(
            {
                "project": "proj",
                "testcase_id": "abc",
                "draft_text": "some text",
            }
        )

    with pytest.raises(ValueError, match="exactly one"):
        await _find_related_testcases({"project": "proj"})


# ---------------------------------------------------------------------------
# list_sources — response parsing
# ---------------------------------------------------------------------------


@respx.mock
@pytest.mark.asyncio
async def test_list_sources_parses_response():
    """list_sources returns the sources list from the API response."""
    from wombat_mcp.tools.api import _list_sources

    payload = {
        "sources": [
            {
                "source_repo": "https://github.com/acme/tests",
                "last_synced_revision": "abc1234",
                "last_synced_at": "2026-04-17T10:00:00+00:00",
            },
            {
                "source_repo": "local-docs",
                "last_synced_revision": "def5678",
                "last_synced_at": "2026-04-18T09:30:00+00:00",
            },
        ]
    }
    respx.get("http://test-api/api/projects/proj/sources").mock(return_value=httpx.Response(200, json=payload))

    result = await _list_sources({"project": "proj"})

    assert "sources" in result
    assert len(result["sources"]) == 2
    first = result["sources"][0]
    assert first["source_repo"] == "https://github.com/acme/tests"
    assert first["last_synced_revision"] == "abc1234"
    assert "last_synced_at" in first


@respx.mock
@pytest.mark.asyncio
async def test_list_sources_empty():
    """list_sources handles an empty sources list."""
    from wombat_mcp.tools.api import _list_sources

    respx.get("http://test-api/api/projects/proj/sources").mock(return_value=httpx.Response(200, json={"sources": []}))
    result = await _list_sources({"project": "proj"})
    assert result["sources"] == []


# ---------------------------------------------------------------------------
# ToolRegistry — build_tool_registry
# ---------------------------------------------------------------------------


def test_build_tool_registry_local_mode():
    """In local mode only local: tools are registered."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("local")
    names = {t.name for t in registry.tool_definitions()}
    assert all(n.startswith("local:") for n in names)
    assert not any(n.startswith("api:") for n in names)


def test_build_tool_registry_api_mode():
    """In api mode only api: tools are registered."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")
    names = {t.name for t in registry.tool_definitions()}
    assert all(n.startswith("api:") for n in names)
    assert not any(n.startswith("local:") for n in names)


def test_build_tool_registry_both_mode():
    """In both mode, local: and api: tools are registered."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("both")
    names = {t.name for t in registry.tool_definitions()}
    assert any(n.startswith("local:") for n in names)
    assert any(n.startswith("api:") for n in names)


@pytest.mark.asyncio
async def test_registry_unknown_tool_raises():
    """Calling an unknown tool raises ValueError."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("local")
    with pytest.raises(ValueError, match="Unknown tool"):
        await registry.call("nonexistent:tool", {})
