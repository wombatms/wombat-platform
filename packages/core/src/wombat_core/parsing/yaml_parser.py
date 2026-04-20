"""Parse YAML files (Plan, Suite) into domain models."""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import ValidationError

from wombat_core.models import Plan, Suite
from wombat_core.parsing.frontmatter import ParseResult, ParseWarning, detect_entity_type

# Only these entity types are stored as plain YAML files
_YAML_MODELS = {Plan, Suite}


def parse_yaml_file(path: Path) -> ParseResult:
    """Parse a YAML file into a Plan or Suite domain model.

    The entity type is detected from the ``id`` field's prefix.
    """
    try:
        with path.open() as fh:
            raw = yaml.safe_load(fh) or {}
    except Exception as exc:  # noqa: BLE001
        return ParseResult(entity=None, source_path=path, error=f"Failed to read file: {exc}")

    if not isinstance(raw, dict):
        return ParseResult(
            entity=None,
            source_path=path,
            error="YAML file must be a mapping at the top level",
        )

    entity_id = raw.get("id")
    if not entity_id:
        return ParseResult(
            entity=None,
            source_path=path,
            error="Missing 'id' field",
        )

    model_cls = detect_entity_type(str(entity_id))
    if model_cls is None:
        return ParseResult(
            entity=None,
            source_path=path,
            error=f"Unknown entity type for id '{entity_id}'",
        )
    if model_cls not in _YAML_MODELS:
        return ParseResult(
            entity=None,
            source_path=path,
            error=f"Entity type '{model_cls.__name__}' should not be stored as a YAML file",
        )

    warnings: list[ParseWarning] = []
    try:
        entity = model_cls(**raw)
    except ValidationError as exc:
        for err in exc.errors():
            field_loc = ".".join(str(loc) for loc in err["loc"])
            warnings.append(ParseWarning(field=field_loc, message=err["msg"]))
        return ParseResult(entity=None, source_path=path, error=str(exc), warnings=warnings)

    return ParseResult(entity=entity, source_path=path, warnings=warnings)
