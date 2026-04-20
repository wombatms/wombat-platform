"""MCP prompts — curated system prompts that tee up MCP tools."""

from __future__ import annotations

import mcp.types as types
from wombat_mcp.prompts.templates import PROMPTS, render_prompt


def list_wombat_prompts() -> list[types.Prompt]:
    """Return the list of registered prompt definitions."""
    return [
        types.Prompt(
            name=name,
            description=meta["description"],
            arguments=[
                types.PromptArgument(
                    name=arg["name"],
                    description=arg.get("description", ""),
                    required=arg.get("required", False),
                )
                for arg in meta.get("arguments", [])
            ],
        )
        for name, meta in PROMPTS.items()
    ]


async def get_wombat_prompt(
    name: str, arguments: dict[str, str]
) -> types.GetPromptResult:
    """Render a prompt by name, substituting *arguments* into the template."""
    if name not in PROMPTS:
        raise ValueError(f"Unknown prompt: {name!r}")
    text = render_prompt(name, arguments)
    return types.GetPromptResult(
        description=PROMPTS[name]["description"],
        messages=[
            types.PromptMessage(
                role="user",
                content=types.TextContent(type="text", text=text),
            )
        ],
    )
