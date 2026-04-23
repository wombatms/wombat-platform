"""Serialize domain models back to their on-disk representation.

Rules:
* Fixed per-entity-type field ordering for stable diffs.
* None values and empty lists/dicts are omitted (round-trip safe because
  Pydantic defaults them back to the same value on re-parse).
* Markdown entities (TestCase, SharedStep, Story) are written as frontmatter
  + optional body.  Plan and Suite are written as plain YAML.
"""

from __future__ import annotations

from io import StringIO
from pathlib import Path

import yaml

from wombat_core.models import Plan, SharedStep, Story, Suite, TestCase

WombatEntity = TestCase | SharedStep | Plan | Story | Suite

# Fixed field order per entity type.  Only fields that appear in the model
# need to be listed; any extras are appended at the end.
_FIELD_ORDER: dict[type, list[str]] = {
    TestCase: [
        "id",
        "title",
        "summary",
        "status",
        "priority",
        "type",
        "component",
        "subcomponent",
        "owner",
        "tags",
        "requirements",
        "preconditions",
        "test_data",
        "shared_steps",
        "steps",
        "automation",
        "review",
        "version",
        "change_reason",
        "superseded_by",
        "environment_constraints",
    ],
    SharedStep: [
        "id",
        "title",
        "owner",
        "tags",
        "variables",
        "steps",
        "version",
    ],
    Story: [
        "id",
        "title",
        "description",
        "coverage",
        "risk",
        "owner",
        "tags",
        "linked_tests",
        "linked_code",
        "linked_docs",
        "version",
    ],
    Plan: [
        "id",
        "title",
        "description",
        "scope",
        "include",
        "exclude",
        "suite_refs",
        "environments",
        "execution",
        "assignees",
        "approvals",
        "explicit_cases",
    ],
    Suite: [
        "id",
        "title",
        "description",
        "parent_wombat_id",
        "owner",
        "tags",
        "cases",
        "include",
    ],
}

# Entity types stored as Markdown (frontmatter + body)
_MARKDOWN_TYPES: frozenset[type] = frozenset({TestCase, SharedStep, Story})


def _clean(value: object) -> object:
    """Recursively drop None values and empty containers from dicts/lists."""
    if isinstance(value, dict):
        cleaned = {k: _clean(v) for k, v in value.items()}
        return {k: v for k, v in cleaned.items() if v is not None and v != [] and v != {}}
    if isinstance(value, list):
        return [_clean(item) for item in value]
    return value


def _ordered_dict(entity: WombatEntity) -> dict:
    """Return an ordered dict representation of *entity* suitable for YAML."""
    order = _FIELD_ORDER.get(type(entity), [])
    # mode="json" ensures StrEnum values serialise as plain strings
    raw: dict = entity.model_dump(mode="json", exclude={"body"})

    result: dict = {}
    seen: set[str] = set()
    for key in order:
        if key in raw:
            val = _clean(raw[key])
            if val is not None and val != [] and val != {}:
                result[key] = val
            seen.add(key)

    # Append any fields not in the explicit order list (future-proof)
    for key, val in raw.items():
        if key not in seen:
            val = _clean(val)
            if val is not None and val != [] and val != {}:
                result[key] = val

    return result


# ---------------------------------------------------------------------------
# Custom YAML dumper that:
#   - preserves insertion order (sort_keys=False)
#   - uses block style for nested mappings/sequences
#   - emits plain strings without quotes where safe
# ---------------------------------------------------------------------------


class _WombatDumper(yaml.Dumper):
    pass


def _str_representer(dumper: yaml.Dumper, data: str) -> yaml.ScalarNode:
    # Use literal block scalar for multiline strings
    if "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


_WombatDumper.add_representer(str, _str_representer)


def _dump_yaml(data: dict) -> str:
    return yaml.dump(
        data,
        Dumper=_WombatDumper,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def serialise_entity(entity: WombatEntity) -> str:
    """Return the canonical string representation of *entity*.

    * Markdown types → ``---\\nfrontmatter\\n---\\nbody``
    * YAML types    → plain YAML
    """
    data = _ordered_dict(entity)

    if type(entity) in _MARKDOWN_TYPES:
        buf = StringIO()
        buf.write("---\n")
        buf.write(_dump_yaml(data))
        buf.write("---\n")
        body: str | None = getattr(entity, "body", None)
        if body:
            buf.write(body)
            if not body.endswith("\n"):
                buf.write("\n")
        return buf.getvalue()

    return _dump_yaml(data)


def write_entity(entity: WombatEntity, path: Path) -> None:
    """Write *entity* to *path* in its canonical format."""
    path.write_text(serialise_entity(entity), encoding="utf-8")


def write_canonical_file(path: Path, body: dict) -> None:
    """Write a ``{"frontmatter": dict, "markdown": str}`` body to *path*.

    This is the inverse of the parser's raw-dict representation used by the
    proposal system. The frontmatter block is serialised as YAML with the
    wombat dumper; the markdown body is appended verbatim after the closing
    ``---`` delimiter.

    For typed domain objects use :func:`write_entity` instead.
    """
    fm = body.get("frontmatter") or {}
    md = body.get("markdown") or ""
    content = "---\n"
    content += _dump_yaml(fm)
    content += "---\n"
    if md:
        content += md
        if not md.endswith("\n"):
            content += "\n"
    path.write_text(content, encoding="utf-8")
