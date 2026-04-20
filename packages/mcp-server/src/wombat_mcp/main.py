"""Entry point for the Wombat MCP stdio server.

Operating modes (set via WOMBAT_MCP_MODE env var):
- ``local``  — only local file-based tools (no API required)
- ``api``    — only API-backed tools (requires WOMBAT_API_URL + WOMBAT_API_TOKEN)
- ``both``   — all tools (default)
"""

from __future__ import annotations

import asyncio
import logging
import os

import mcp.types as types
from mcp.server import Server
from mcp.server.stdio import stdio_server

from wombat_mcp.resources import list_wombat_resources, read_wombat_resource
from wombat_mcp.prompts import list_wombat_prompts, get_wombat_prompt
from wombat_mcp.tools import build_tool_registry

logger = logging.getLogger(__name__)


def _mode() -> str:
    return os.environ.get("WOMBAT_MCP_MODE", "both").lower()


def create_server() -> Server:
    """Construct and wire the MCP server."""
    server = Server("wombat-mcp")
    mode = _mode()

    registry = build_tool_registry(mode)

    @server.list_tools()
    async def handle_list_tools() -> list[types.Tool]:
        return registry.tool_definitions()

    @server.call_tool()
    async def handle_call_tool(name: str, arguments: dict) -> list[types.TextContent]:
        result = await registry.call(name, arguments)
        import json
        text = json.dumps(result, default=str) if not isinstance(result, str) else result
        return [types.TextContent(type="text", text=text)]

    @server.list_resources()
    async def handle_list_resources() -> list[types.Resource]:
        return await list_wombat_resources()

    @server.read_resource()
    async def handle_read_resource(uri) -> str:
        return await read_wombat_resource(str(uri))

    @server.list_prompts()
    async def handle_list_prompts() -> list[types.Prompt]:
        return list_wombat_prompts()

    @server.get_prompt()
    async def handle_get_prompt(
        name: str, arguments: dict[str, str] | None
    ) -> types.GetPromptResult:
        return await get_wombat_prompt(name, arguments or {})

    return server


async def _run() -> None:
    logging.basicConfig(level=logging.WARNING)
    server = create_server()
    async with stdio_server() as (read_stream, write_stream):
        init_opts = server.create_initialization_options()
        await server.run(read_stream, write_stream, init_opts)


def main() -> None:
    """Console script entry point."""
    asyncio.run(_run())


if __name__ == "__main__":
    main()
