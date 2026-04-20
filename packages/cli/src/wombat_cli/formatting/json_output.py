"""JSON output helpers for machine-readable CLI output."""

from __future__ import annotations

import json
from typing import Any


def dump(data: Any) -> str:
    """Serialize data to JSON string."""
    return json.dumps(data, indent=2, default=_default)


def print_json(data: Any) -> None:
    """Print JSON to stdout."""
    print(dump(data))


def print_error(
    code: str,
    message: str,
    *,
    field: str | None = None,
    hint: str | None = None,
) -> None:
    """Print a structured error to stdout (for --json mode)."""
    error: dict[str, Any] = {"code": code, "message": message}
    if field is not None:
        error["field"] = field
    if hint is not None:
        error["hint"] = hint
    print_json({"error": error})


def _default(obj: Any) -> Any:
    """JSON serializer for objects not serializable by default."""
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "__dict__"):
        return obj.__dict__
    return str(obj)


def entity_to_dict(entity: Any) -> dict[str, Any]:
    """Convert a Pydantic model to a JSON-serializable dict."""
    if hasattr(entity, "model_dump"):
        return entity.model_dump()
    return dict(entity)
