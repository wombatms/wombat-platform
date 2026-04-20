"""MCP resources exposed under the ``wombat://`` URI scheme.

Resources:
- ``wombat://config``               — current .wombat/config.yaml as JSON
- ``wombat://schemas/{kind}``       — JSON schema for a domain entity kind
- ``wombat://templates/{kind}``     — Markdown template for a domain entity kind
- ``wombat://taxonomy``             — taxonomy values (components, environments) from config
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import mcp.types as types

from wombat_mcp.resources.schemas import (
    list_schema_resources,
    list_template_resources,
    read_schema_resource,
    read_template_resource,
)


async def list_wombat_resources() -> list[types.Resource]:
    """Return the full list of static wombat:// resources."""
    resources: list[types.Resource] = []

    # config
    resources.append(
        types.Resource(
            uri="wombat://config",
            name="Wombat config",
            description="Current .wombat/config.yaml parsed as JSON.",
            mimeType="application/json",
        )
    )

    # taxonomy
    resources.append(
        types.Resource(
            uri="wombat://taxonomy",
            name="Wombat taxonomy",
            description="Taxonomy values (components, environments) from config.",
            mimeType="application/json",
        )
    )

    # schemas per kind
    resources.extend(list_schema_resources())

    # templates per kind
    resources.extend(list_template_resources())

    return resources


async def read_wombat_resource(uri: str) -> str:
    """Dispatch a wombat:// URI to the appropriate reader."""
    if uri == "wombat://config":
        return _read_config()
    if uri == "wombat://taxonomy":
        return _read_taxonomy()
    if uri.startswith("wombat://schemas/"):
        kind = uri[len("wombat://schemas/") :]
        return read_schema_resource(kind)
    if uri.startswith("wombat://templates/"):
        kind = uri[len("wombat://templates/") :]
        return read_template_resource(kind)
    raise ValueError(f"Unknown wombat:// resource: {uri!r}")


# ---------------------------------------------------------------------------
# Config / taxonomy readers
# ---------------------------------------------------------------------------


def _repo_path() -> Path:
    """Return WOMBAT_REPO_PATH or cwd."""
    return Path(os.environ.get("WOMBAT_REPO_PATH", "."))


def _read_config() -> str:
    import dataclasses

    from wombat_core.config.loader import load_config

    config = load_config(_repo_path())
    # Convert the dataclass hierarchy to a plain dict for JSON serialisation
    data = dataclasses.asdict(config) if dataclasses.is_dataclass(config) else vars(config)
    # config_path is a Path object — convert to str
    if "config_path" in data and data["config_path"] is not None:
        data["config_path"] = str(data["config_path"])
    return json.dumps(data, default=str)


def _read_taxonomy() -> str:
    import dataclasses

    from wombat_core.config.loader import load_config

    config = load_config(_repo_path())
    tax = config.taxonomy
    data = dataclasses.asdict(tax) if dataclasses.is_dataclass(tax) else vars(tax)
    return json.dumps(data)
