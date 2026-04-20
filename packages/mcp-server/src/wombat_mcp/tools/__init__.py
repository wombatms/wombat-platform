"""Tool registry — selects local and/or API tools based on operating mode."""

from __future__ import annotations

import mcp.types as types


class ToolRegistry:
    """Holds registered tool definitions and their async callables."""

    def __init__(self) -> None:
        self._tools: dict[str, tuple[types.Tool, object]] = {}

    def register(self, tool: types.Tool, handler) -> None:  # noqa: ANN001
        self._tools[tool.name] = (tool, handler)

    def tool_definitions(self) -> list[types.Tool]:
        return [t for t, _ in self._tools.values()]

    async def call(self, name: str, arguments: dict) -> object:
        if name not in self._tools:
            raise ValueError(f"Unknown tool: {name!r}")
        _, handler = self._tools[name]
        return await handler(arguments)


def build_tool_registry(mode: str) -> ToolRegistry:
    """Build a ToolRegistry populated based on the operating *mode*.

    Parameters
    ----------
    mode:
        ``"local"``, ``"api"``, or ``"both"`` (default).
    """
    registry = ToolRegistry()

    if mode in ("local", "both"):
        from wombat_mcp.tools.local import register_local_tools
        register_local_tools(registry)

    if mode in ("api", "both"):
        from wombat_mcp.tools.api import register_api_tools
        register_api_tools(registry)

    return registry
