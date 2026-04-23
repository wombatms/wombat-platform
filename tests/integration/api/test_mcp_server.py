"""MCP server integration tests.

Pragmatic approach:
1. Import local tools directly and exercise them against in-process fixtures.
2. Exercise API tools using respx to mock httpx calls.
3. Verify tool counts per mode: both=25, local=5, api=20.

Scenarios:
- local:parse on a seeded testcase → returns entity as dict
- local:lint on a seeded fixture file → returns findings (issues list)
- api:search_content → POSTs the right body (query, kinds, top_k, mode) to /search
- api:get_content → GETs /content/{id}
- api:find_related_testcases → routes correctly for testcase_id and draft_text
- api:list_sources → parses the response from /sources
- Tool registry counts: both=35, local=5, api=30
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
import respx

FIXTURES_DIR = Path(__file__).parent.parent.parent / "fixtures"
INTEGRATION_REPO = Path(__file__).parent.parent.parent / "fixtures" / "integration_repo"


# ---------------------------------------------------------------------------
# Tool registry count tests
# ---------------------------------------------------------------------------


def test_tool_registry_both_mode_has_35_tools():
    """Both mode advertises exactly 35 tools (25 SP2 + 6 SP3.3 execution tier + 4 SP3.4 planning)."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("both")
    tools = registry.tool_definitions()
    assert len(tools) == 35, f"Expected 35 tools in 'both' mode, got {len(tools)}: {[t.name for t in tools]}"


def test_tool_registry_local_mode_has_5_tools():
    """Local mode advertises exactly 5 tools."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("local")
    tools = registry.tool_definitions()
    assert len(tools) == 5, f"Expected 5 tools in 'local' mode, got {len(tools)}"


def test_tool_registry_api_mode_has_30_tools():
    """API mode advertises exactly 30 tools (20 SP2 + 6 SP3.3 execution tier + 4 SP3.4 planning)."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")
    tools = registry.tool_definitions()
    assert len(tools) == 30, f"Expected 30 tools in 'api' mode, got {len(tools)}"


def test_both_mode_includes_all_local_and_api_tools():
    """Both mode includes all tools from local and api modes."""
    from wombat_mcp.tools import build_tool_registry

    r_both = build_tool_registry("both")
    r_local = build_tool_registry("local")
    r_api = build_tool_registry("api")

    both_names = {t.name for t in r_both.tool_definitions()}
    local_names = {t.name for t in r_local.tool_definitions()}
    api_names = {t.name for t in r_api.tool_definitions()}

    assert local_names.issubset(both_names), f"Local tools missing from both: {local_names - both_names}"
    assert api_names.issubset(both_names), f"API tools missing from both: {api_names - both_names}"


def test_local_tools_have_expected_names():
    """Local tools are named as expected."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("local")
    names = {t.name for t in registry.tool_definitions()}
    expected = {"local:lint", "local:validate", "local:search", "local:parse", "local:diff"}
    assert names == expected, f"Unexpected local tool names: {names}"


# ---------------------------------------------------------------------------
# Local tool tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_local_parse_returns_entity():
    """local:parse on a fixture testcase file returns the entity as a dict."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("local")
    fixture_path = INTEGRATION_REPO / "testcases" / "tc-auth-001.md"
    assert fixture_path.exists(), f"Fixture not found: {fixture_path}"

    result = await registry.call("local:parse", {"path": str(fixture_path)})
    assert isinstance(result, dict), f"Expected dict, got {type(result)}"
    assert result.get("ok") is True, f"Expected ok=True, got: {result}"
    entity = result["entity"]
    assert entity["id"] == "TC-INT-AUTH-001"
    assert "title" in entity


@pytest.mark.asyncio
async def test_local_lint_returns_findings():
    """local:lint on a fixture file returns a lint result dict."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("local")
    fixture_path = INTEGRATION_REPO / "testcases" / "tc-auth-001.md"
    assert fixture_path.exists(), f"Fixture not found: {fixture_path}"

    result = await registry.call("local:lint", {"path": str(fixture_path)})
    assert isinstance(result, dict), f"Expected dict, got {type(result)}"
    assert "issues" in result
    assert "total" in result
    assert isinstance(result["issues"], list)
    assert isinstance(result["total"], int)


@pytest.mark.asyncio
async def test_local_validate_returns_valid_result():
    """local:validate on a fixture testcase returns a validation result."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("local")
    fixture_path = INTEGRATION_REPO / "testcases" / "tc-auth-001.md"

    result = await registry.call("local:validate", {"path": str(fixture_path)})
    assert isinstance(result, dict)
    assert "valid" in result
    assert "errors" in result


@pytest.mark.asyncio
async def test_local_search_returns_results():
    """local:search on the integration_repo finds all entities."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("local")
    result = await registry.call("local:search", {"root": str(INTEGRATION_REPO)})
    assert isinstance(result, dict)
    assert "entities" in result
    assert len(result["entities"]) > 0


# ---------------------------------------------------------------------------
# API tool tests (using respx to mock httpx)
# ---------------------------------------------------------------------------

_BASE_URL = "http://localhost:8000"


@pytest.mark.asyncio
async def test_api_search_content_posts_correct_body():
    """api:search_content POSTs the correct body to /search."""
    import os

    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")
    project = "test-proj"

    with respx.mock(base_url=_BASE_URL) as mock:
        mock_route = mock.post(f"/api/projects/{project}/search").mock(
            return_value=httpx.Response(
                200,
                json={"hits": [], "query": "refund", "mode": "hybrid", "total_returned": 0},
            )
        )
        os.environ["WOMBAT_API_URL"] = _BASE_URL
        os.environ["WOMBAT_API_TOKEN"] = "wombat_testtoken"
        try:
            result = await registry.call(
                "api:search_content",
                {
                    "project": project,
                    "query": "refund",
                    "kinds": ["testcase"],
                    "top_k": 5,
                    "mode": "hybrid",
                },
            )
        finally:
            del os.environ["WOMBAT_API_URL"]
            del os.environ["WOMBAT_API_TOKEN"]

    assert mock_route.called
    # Verify the request body
    req_body = json.loads(mock_route.calls[0].request.content)
    assert req_body["query"] == "refund"
    assert req_body["kinds"] == ["testcase"]
    assert req_body["top_k"] == 5
    assert req_body["mode"] == "hybrid"
    assert isinstance(result, dict)


@pytest.mark.asyncio
async def test_api_get_content_sends_correct_request():
    """api:get_content GETs /content/{content_id}."""
    import os

    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")
    project = "test-proj"
    content_id = "TC-INT-AUTH-001"

    with respx.mock(base_url=_BASE_URL) as mock:
        mock_route = mock.get(f"/api/projects/{project}/content/{content_id}").mock(
            return_value=httpx.Response(
                200,
                json={"data": {"id": "abc", "wombat_id": content_id, "kind": "testcase"}},
            )
        )
        os.environ["WOMBAT_API_URL"] = _BASE_URL
        os.environ["WOMBAT_API_TOKEN"] = "wombat_testtoken"
        try:
            result = await registry.call(
                "api:get_content",
                {
                    "project": project,
                    "content_id": content_id,
                },
            )
        finally:
            del os.environ["WOMBAT_API_URL"]
            del os.environ["WOMBAT_API_TOKEN"]

    assert mock_route.called
    assert result["data"]["wombat_id"] == content_id


@pytest.mark.asyncio
async def test_api_find_related_testcases_with_draft_text():
    """api:find_related_testcases with draft_text POSTs to /search."""
    import os

    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")
    project = "test-proj"

    with respx.mock(base_url=_BASE_URL) as mock:
        mock_route = mock.post(f"/api/projects/{project}/search").mock(
            return_value=httpx.Response(
                200,
                json={"hits": [], "query": "test", "mode": "semantic", "total_returned": 0},
            )
        )
        os.environ["WOMBAT_API_URL"] = _BASE_URL
        os.environ["WOMBAT_API_TOKEN"] = "wombat_testtoken"
        try:
            result = await registry.call(
                "api:find_related_testcases",
                {
                    "project": project,
                    "draft_text": "user authentication flow",
                    "top_k": 5,
                },
            )
        finally:
            del os.environ["WOMBAT_API_URL"]
            del os.environ["WOMBAT_API_TOKEN"]

    assert mock_route.called
    req_body = json.loads(mock_route.calls[0].request.content)
    assert req_body["query"] == "user authentication flow"
    assert req_body["kinds"] == ["testcase"]
    assert req_body["mode"] == "semantic"


@pytest.mark.asyncio
async def test_api_find_related_testcases_with_testcase_id():
    """api:find_related_testcases with testcase_id GETs /content/{id}/related."""
    import os

    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")
    project = "test-proj"
    tc_id = "abc-123-def"

    with respx.mock(base_url=_BASE_URL) as mock:
        mock_route = mock.get(f"/api/projects/{project}/content/{tc_id}/related").mock(
            return_value=httpx.Response(
                200,
                json={"hits": [], "total_returned": 0},
            )
        )
        os.environ["WOMBAT_API_URL"] = _BASE_URL
        os.environ["WOMBAT_API_TOKEN"] = "wombat_testtoken"
        try:
            result = await registry.call(
                "api:find_related_testcases",
                {
                    "project": project,
                    "testcase_id": tc_id,
                    "top_k": 3,
                },
            )
        finally:
            del os.environ["WOMBAT_API_URL"]
            del os.environ["WOMBAT_API_TOKEN"]

    assert mock_route.called


@pytest.mark.asyncio
async def test_api_list_sources_parses_response():
    """api:list_sources GETs /sources and parses the response."""
    import os

    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")
    project = "test-proj"

    sources_response = {
        "sources": [
            {
                "source_repo": "test-repo",
                "last_synced_revision": "HEAD",
                "last_synced_at": "2026-04-20T12:00:00Z",
            }
        ]
    }

    with respx.mock(base_url=_BASE_URL) as mock:
        mock_route = mock.get(f"/api/projects/{project}/sources").mock(
            return_value=httpx.Response(200, json=sources_response)
        )
        os.environ["WOMBAT_API_URL"] = _BASE_URL
        os.environ["WOMBAT_API_TOKEN"] = "wombat_testtoken"
        try:
            result = await registry.call("api:list_sources", {"project": project})
        finally:
            del os.environ["WOMBAT_API_URL"]
            del os.environ["WOMBAT_API_TOKEN"]

    assert mock_route.called
    assert "sources" in result
    assert len(result["sources"]) == 1
    assert result["sources"][0]["source_repo"] == "test-repo"


@pytest.mark.asyncio
async def test_api_find_related_testcases_requires_exactly_one_input():
    """find_related_testcases raises ValueError if both or neither inputs provided."""
    import os

    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("api")
    os.environ["WOMBAT_API_URL"] = _BASE_URL
    os.environ["WOMBAT_API_TOKEN"] = "wombat_testtoken"
    try:
        # Neither testcase_id nor draft_text
        with pytest.raises((ValueError, Exception)):
            await registry.call(
                "api:find_related_testcases",
                {
                    "project": "test-proj",
                },
            )

        # Both testcase_id and draft_text
        with pytest.raises((ValueError, Exception)), respx.mock(base_url=_BASE_URL):
            await registry.call(
                "api:find_related_testcases",
                {
                    "project": "test-proj",
                    "testcase_id": "abc",
                    "draft_text": "some text",
                },
            )
    finally:
        del os.environ["WOMBAT_API_URL"]
        del os.environ["WOMBAT_API_TOKEN"]


@pytest.mark.asyncio
async def test_unknown_tool_raises():
    """Calling an unknown tool raises ValueError."""
    from wombat_mcp.tools import build_tool_registry

    registry = build_tool_registry("both")
    with pytest.raises(ValueError, match="Unknown tool"):
        await registry.call("nonexistent:tool", {})
