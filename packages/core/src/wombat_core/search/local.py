"""Local filesystem search over a Wombat corpus directory."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from wombat_core.models import Plan, SharedStep, Story, Suite, TestCase
from wombat_core.parsing.frontmatter import parse_markdown_file
from wombat_core.parsing.yaml_parser import parse_yaml_file

WombatEntity = TestCase | SharedStep | Plan | Story | Suite

_DEFAULT_LIMIT = 50

# Entity type name → class mapping for the ``entity_type`` filter
_TYPE_NAME_MAP: dict[str, type[WombatEntity]] = {
    "testcase": TestCase,
    "test_case": TestCase,
    "shared_step": SharedStep,
    "sharedstep": SharedStep,
    "plan": Plan,
    "story": Story,
    "suite": Suite,
}


@dataclass
class SearchResult:
    entities: list[WombatEntity] = field(default_factory=list)
    total: int = 0
    limit: int = _DEFAULT_LIMIT
    offset: int = 0

    @property
    def has_more(self) -> bool:
        return (self.offset + self.limit) < self.total


def _load_file(path: Path) -> WombatEntity | None:
    """Parse a single file; return the entity or None on failure."""
    suffix = path.suffix.lower()
    if suffix == ".md":
        result = parse_markdown_file(path)
    elif suffix in {".yaml", ".yml"}:
        result = parse_yaml_file(path)
    else:
        return None
    return result.entity if result.ok else None


def _collect_entities(root: Path) -> list[WombatEntity]:
    """Walk *root* recursively and parse every .md / .yaml file."""
    entities: list[WombatEntity] = []
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in {".md", ".yaml", ".yml"}:
            entity = _load_file(path)
            if entity is not None:
                entities.append(entity)
    return entities


def _resolve_type_filter(entity_type: str | None) -> type[WombatEntity] | None:
    if entity_type is None:
        return None
    key = entity_type.lower()
    return _TYPE_NAME_MAP.get(key)


def _matches(
    entity: WombatEntity,
    *,
    type_cls: type[WombatEntity] | None,
    component: str | None,
    owner: str | None,
    priority: str | None,
    status: str | None,
    tags: list[str] | None,
    test_type: str | None,
) -> bool:
    """Return True if *entity* satisfies all provided filters (AND logic)."""
    if type_cls is not None and not isinstance(entity, type_cls):
        return False

    if component is not None:
        entity_component = getattr(entity, "component", None)
        if entity_component != component:
            return False

    if owner is not None:
        entity_owner = getattr(entity, "owner", None)
        if entity_owner != owner:
            return False

    if priority is not None:
        entity_priority = getattr(entity, "priority", None)
        if entity_priority != priority:
            return False

    if status is not None:
        entity_status = getattr(entity, "status", None)
        if entity_status != status:
            return False

    if tags is not None:
        entity_tags: list[str] = getattr(entity, "tags", [])
        if not all(t in entity_tags for t in tags):
            return False

    if test_type is not None:
        entity_type_field = getattr(entity, "type", None)
        if entity_type_field != test_type:
            return False

    return True


def search_files(
    root: Path,
    *,
    entity_type: str | None = None,
    component: str | None = None,
    owner: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    tags: list[str] | None = None,
    type: str | None = None,  # noqa: A002  (matches the domain vocabulary)
    limit: int = _DEFAULT_LIMIT,
    offset: int = 0,
) -> SearchResult:
    """Search a corpus directory tree and return matching entities.

    Filters are AND-combined: every provided filter must match.

    Parameters
    ----------
    root:
        Directory to scan recursively.
    entity_type:
        Filter by entity class name (``"testcase"``, ``"plan"``, etc.).
    component:
        Exact match on ``entity.component`` (TestCase / Suite).
    owner:
        Exact match on ``entity.owner``.
    priority:
        Exact match on ``entity.priority`` (TestCase).
    status:
        Exact match on ``entity.status`` (TestCase).
    tags:
        All listed tags must be present in ``entity.tags`` (AND logic).
    type:
        Exact match on ``entity.type`` (TestCase ``TestType``).
    limit:
        Maximum results to return (default 50).
    offset:
        Skip the first *offset* matches (for pagination).
    """
    all_entities = _collect_entities(root)

    type_cls = _resolve_type_filter(entity_type)

    matched: list[WombatEntity] = [
        e
        for e in all_entities
        if _matches(
            e,
            type_cls=type_cls,
            component=component,
            owner=owner,
            priority=priority,
            status=status,
            tags=tags,
            test_type=type,
        )
    ]

    total = len(matched)
    page = matched[offset : offset + limit]

    return SearchResult(entities=page, total=total, limit=limit, offset=offset)
