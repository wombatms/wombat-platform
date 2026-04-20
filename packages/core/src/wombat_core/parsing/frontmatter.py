"""Parse .md files with YAML frontmatter into domain models."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import frontmatter
from pydantic import ValidationError

from wombat_core.models import Plan, SharedStep, Story, Suite, TestCase

WombatEntity = TestCase | SharedStep | Plan | Story | Suite

# Maps WombatID prefix to entity class
_PREFIX_TO_MODEL: dict[str, type[WombatEntity]] = {
    "TC": TestCase,
    "SS": SharedStep,
    "PLAN": Plan,
    "STORY": Story,
    "SUITE": Suite,
}

# Entity types that support a markdown body field
_HAS_BODY: frozenset[type] = frozenset({TestCase, SharedStep, Story})


@dataclass
class ParseWarning:
    field: str
    message: str


@dataclass
class ParseResult:
    entity: WombatEntity | None
    warnings: list[ParseWarning] = field(default_factory=list)
    source_path: Path | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.entity is not None and self.error is None


def detect_entity_type(entity_id: str) -> type[WombatEntity] | None:
    """Return the model class for a WombatID, or None if prefix is unknown."""
    prefix = entity_id.split("-", 1)[0]
    return _PREFIX_TO_MODEL.get(prefix)


def parse_markdown_file(path: Path) -> ParseResult:
    """Parse a Markdown file with YAML frontmatter into a domain model.

    The entity type is detected from the ``id`` field's prefix (e.g. TC-, SS-).
    For entity types that carry a body (TestCase, SharedStep, Story) the
    Markdown content after the frontmatter block is stored in ``entity.body``.
    """
    try:
        post = frontmatter.load(str(path))
    except Exception as exc:  # noqa: BLE001
        return ParseResult(entity=None, source_path=path, error=f"Failed to read file: {exc}")

    metadata: dict = dict(post.metadata)
    body_text: str = post.content.strip() if post.content else ""

    entity_id = metadata.get("id")
    if not entity_id:
        return ParseResult(
            entity=None,
            source_path=path,
            error="Missing 'id' field in frontmatter",
        )

    model_cls = detect_entity_type(str(entity_id))
    if model_cls is None:
        return ParseResult(
            entity=None,
            source_path=path,
            error=f"Unknown entity type for id '{entity_id}'",
        )

    # Inject body for models that support it
    if model_cls in _HAS_BODY and body_text:
        metadata["body"] = body_text

    warnings: list[ParseWarning] = []
    try:
        entity: WombatEntity = model_cls(**metadata)
    except ValidationError as exc:
        for err in exc.errors():
            field_loc = ".".join(str(loc) for loc in err["loc"])
            warnings.append(ParseWarning(field=field_loc, message=err["msg"]))
        return ParseResult(entity=None, source_path=path, error=str(exc), warnings=warnings)

    return ParseResult(entity=entity, source_path=path, warnings=warnings)
