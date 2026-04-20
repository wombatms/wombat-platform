"""File-based MCP tools (local mode).

These tools operate directly against the local filesystem via ``wombat_core``
and do not require a running API server.

Tools registered:
- ``local:lint``         — run lint rules against a path
- ``local:validate``     — run schema/structural validation against a path
- ``local:search``       — keyword/tag search across a corpus directory
- ``local:parse``        — parse a single entity file and return its JSON repr
- ``local:diff``         — compare two entity files; or show a single entity's fields
"""

from __future__ import annotations

import os
from pathlib import Path

import mcp.types as types


# ---------------------------------------------------------------------------
# Tool definitions (JSON Schema input schemas)
# ---------------------------------------------------------------------------

_LINT_TOOL = types.Tool(
    name="local:lint",
    description=(
        "Run Wombat lint rules against a file or directory. "
        "Returns a list of lint issues (rule, severity, message, entity_id, field)."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path to a .md / .yaml entity file or corpus directory.",
            },
        },
        "required": ["path"],
    },
)

_VALIDATE_TOOL = types.Tool(
    name="local:validate",
    description=(
        "Run schema and structural validation against a file or directory. "
        "Returns valid/invalid status plus any errors and warnings."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path to a .md / .yaml entity file or corpus directory.",
            },
        },
        "required": ["path"],
    },
)

_SEARCH_TOOL = types.Tool(
    name="local:search",
    description=(
        "Keyword and tag search across a local Wombat corpus directory. "
        "Filters are AND-combined. Returns matching entities as JSON."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "root": {
                "type": "string",
                "description": "Absolute path to the corpus root directory.",
            },
            "entity_type": {
                "type": "string",
                "description": "Filter by entity type: testcase, shared_step, plan, story, suite.",
                "enum": ["testcase", "shared_step", "plan", "story", "suite"],
            },
            "component": {"type": "string", "description": "Filter by component (exact match)."},
            "owner": {"type": "string", "description": "Filter by owner (exact match)."},
            "priority": {"type": "string", "description": "Filter by priority (exact match)."},
            "status": {"type": "string", "description": "Filter by status (exact match)."},
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "All listed tags must be present (AND logic).",
            },
            "limit": {
                "type": "integer",
                "default": 50,
                "description": "Maximum number of results to return.",
            },
            "offset": {
                "type": "integer",
                "default": 0,
                "description": "Pagination offset.",
            },
        },
        "required": ["root"],
    },
)

_PARSE_TOOL = types.Tool(
    name="local:parse",
    description="Parse a single Wombat entity file (.md or .yaml) and return its full JSON representation.",
    inputSchema={
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Absolute path to the entity file.",
            },
        },
        "required": ["path"],
    },
)

_DIFF_TOOL = types.Tool(
    name="local:diff",
    description=(
        "Compare two versions of a Wombat entity. "
        "Provide file_a and file_b to compare two files. "
        "Provide only file_a to compare against the live entity in the corpus. "
        "Provide only entity_id (with root) to inspect the current entity without diff."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "entity_id": {
                "type": "string",
                "description": "WombatID of the entity (e.g. TC-LOGIN-001).",
            },
            "file_a": {
                "type": "string",
                "description": "Absolute path to the first entity file.",
            },
            "file_b": {
                "type": "string",
                "description": "Absolute path to the second entity file (for file-vs-file diff).",
            },
            "root": {
                "type": "string",
                "description": "Absolute path to corpus root (required when looking up live entity).",
            },
        },
        "required": [],
    },
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _entity_to_dict(entity) -> dict:  # noqa: ANN001
    """Convert a WombatEntity to a plain dict for JSON serialisation."""
    try:
        return entity.model_dump(mode="json")
    except AttributeError:
        # Fallback for entities that don't use pydantic v2 model_dump
        import dataclasses
        if dataclasses.is_dataclass(entity):
            return dataclasses.asdict(entity)
        return vars(entity)


def _repo_path() -> str | None:
    return os.environ.get("WOMBAT_REPO_PATH")


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------

async def _lint(args: dict) -> dict:
    from wombat_core.config.loader import load_config
    from wombat_core.linting import LintEngine
    from wombat_core.search.local import search_files

    path = Path(args["path"])
    config = load_config(path if path.is_dir() else path.parent)
    if path.is_dir():
        result = search_files(path, limit=100_000)
        entities = result.entities
    else:
        from wombat_core.parsing import parse_markdown_file, parse_yaml_file
        suffix = path.suffix.lower()
        if suffix == ".md":
            pr = parse_markdown_file(path)
        elif suffix in (".yaml", ".yml"):
            pr = parse_yaml_file(path)
        else:
            return {"error": f"Unsupported file suffix: {path.suffix}"}
        if not pr.ok:
            return {"error": pr.error or "parse failed"}
        entities = [pr.entity]

    if not entities:
        return {"issues": [], "total": 0}

    engine = LintEngine(config)
    issues = engine.lint_corpus(entities)
    return {
        "issues": [
            {
                "rule": i.rule,
                "severity": i.severity,
                "message": i.message,
                "entity_id": i.entity_id,
                "field": i.field,
            }
            for i in issues
        ],
        "total": len(issues),
    }


async def _validate(args: dict) -> dict:
    from wombat_core.search.local import search_files
    from wombat_core.validation import validate_corpus, validate_entity

    path = Path(args["path"])
    if path.is_dir():
        result = search_files(path, limit=100_000)
        entities = result.entities
        if not entities:
            return {"valid": True, "errors": [], "warnings": [], "entity_count": 0}
        vr = validate_corpus(entities)
    else:
        from wombat_core.parsing import parse_markdown_file, parse_yaml_file
        suffix = path.suffix.lower()
        if suffix == ".md":
            pr = parse_markdown_file(path)
        elif suffix in (".yaml", ".yml"):
            pr = parse_yaml_file(path)
        else:
            return {"error": f"Unsupported file suffix: {path.suffix}"}
        if not pr.ok:
            return {"error": pr.error or "parse failed"}
        vr = validate_entity(pr.entity)
        entities = [pr.entity]

    return {
        "valid": vr.valid,
        "entity_count": len(entities),
        "errors": [
            {"field": e.field, "message": e.message, "entity_id": e.entity_id}
            for e in vr.errors
        ],
        "warnings": [
            {"field": w.field, "message": w.message, "entity_id": w.entity_id}
            for w in vr.warnings
        ],
    }


async def _search(args: dict) -> dict:
    from wombat_core.search.local import search_files

    root = Path(args["root"])
    result = search_files(
        root,
        entity_type=args.get("entity_type"),
        component=args.get("component"),
        owner=args.get("owner"),
        priority=args.get("priority"),
        status=args.get("status"),
        tags=args.get("tags"),
        limit=args.get("limit", 50),
        offset=args.get("offset", 0),
    )
    return {
        "entities": [_entity_to_dict(e) for e in result.entities],
        "total": result.total,
        "limit": result.limit,
        "offset": result.offset,
        "has_more": result.has_more,
    }


async def _parse(args: dict) -> dict:
    from wombat_core.parsing import parse_markdown_file, parse_yaml_file

    path = Path(args["path"])
    suffix = path.suffix.lower()
    if suffix == ".md":
        pr = parse_markdown_file(path)
    elif suffix in (".yaml", ".yml"):
        pr = parse_yaml_file(path)
    else:
        return {"error": f"Unsupported file suffix: {path.suffix}"}

    if not pr.ok:
        return {
            "ok": False,
            "error": pr.error or "parse failed",
            "warnings": [{"field": w.field, "message": w.message} for w in pr.warnings],
        }
    return {
        "ok": True,
        "entity": _entity_to_dict(pr.entity),
        "warnings": [{"field": w.field, "message": w.message} for w in pr.warnings],
    }


async def _diff(args: dict) -> dict:
    from wombat_core.parsing import parse_markdown_file, parse_yaml_file
    from wombat_core.search.local import search_files

    def _parse_file(path: Path):  # noqa: ANN202
        suffix = path.suffix.lower()
        if suffix == ".md":
            pr = parse_markdown_file(path)
        elif suffix in (".yaml", ".yml"):
            pr = parse_yaml_file(path)
        else:
            return None
        return pr.entity if pr.ok else None

    file_a = args.get("file_a")
    file_b = args.get("file_b")
    entity_id = args.get("entity_id")
    root = args.get("root")

    if file_a and file_b:
        ea = _parse_file(Path(file_a))
        eb = _parse_file(Path(file_b))
        if ea is None:
            return {"error": f"Could not parse: {file_a}"}
        if eb is None:
            return {"error": f"Could not parse: {file_b}"}
        old_data = _entity_to_dict(ea)
        new_data = _entity_to_dict(eb)

    elif file_a and entity_id and root:
        # file vs live entity
        ea = _parse_file(Path(file_a))
        if ea is None:
            return {"error": f"Could not parse: {file_a}"}
        result = search_files(Path(root), limit=100_000)
        live = next((e for e in result.entities if getattr(e, "id", None) == entity_id), None)
        if live is None:
            return {"error": f"Entity '{entity_id}' not found in corpus at {root!r}"}
        old_data = _entity_to_dict(live)
        new_data = _entity_to_dict(ea)

    elif entity_id and root:
        # inspect current entity only
        result = search_files(Path(root), limit=100_000)
        entity = next((e for e in result.entities if getattr(e, "id", None) == entity_id), None)
        if entity is None:
            return {"error": f"Entity '{entity_id}' not found in corpus at {root!r}"}
        return {"entity_id": entity_id, "entity": _entity_to_dict(entity)}

    else:
        return {
            "error": (
                "Provide (file_a + file_b) for file-vs-file diff, "
                "(file_a + entity_id + root) for file-vs-live, "
                "or (entity_id + root) to inspect current entity."
            )
        }

    changed_fields = [
        k for k in set(old_data) | set(new_data)
        if old_data.get(k) != new_data.get(k)
    ]
    return {
        "entity_id": entity_id,
        "old": old_data,
        "new": new_data,
        "changed_fields": changed_fields,
    }


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_local_tools(registry) -> None:  # noqa: ANN001
    """Register all local file-based tools into *registry*."""
    registry.register(_LINT_TOOL, _lint)
    registry.register(_VALIDATE_TOOL, _validate)
    registry.register(_SEARCH_TOOL, _search)
    registry.register(_PARSE_TOOL, _parse)
    registry.register(_DIFF_TOOL, _diff)
