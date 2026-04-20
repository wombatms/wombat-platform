"""Validation layer: validate individual entities and whole corpora."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from wombat_core.models import Plan, SharedStep, Story, Suite, TestCase

WombatEntity = TestCase | SharedStep | Plan | Story | Suite

# ID prefix that is valid for each entity class
_EXPECTED_PREFIX: dict[type, str] = {
    TestCase: "TC",
    SharedStep: "SS",
    Plan: "PLAN",
    Story: "STORY",
    Suite: "SUITE",
}

_WOMBAT_ID_RE = re.compile(r"^(TC|SS|PLAN|STORY|SUITE)-[A-Z0-9][-A-Z0-9]*$")


@dataclass
class ValidationError:
    field: str
    message: str
    entity_id: str | None = None


@dataclass
class ValidationWarning:
    field: str
    message: str
    entity_id: str | None = None


@dataclass
class ValidationResult:
    valid: bool
    errors: list[ValidationError] = field(default_factory=list)
    warnings: list[ValidationWarning] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Single-entity validation
# ---------------------------------------------------------------------------


def _check_id_prefix(entity: WombatEntity) -> list[ValidationError]:
    """Verify that the ID prefix matches the entity type."""
    expected = _EXPECTED_PREFIX.get(type(entity))
    if expected is None:
        return []
    prefix = entity.id.split("-", 1)[0]
    if prefix != expected:
        return [
            ValidationError(
                field="id",
                message=(
                    f"ID prefix '{prefix}' does not match entity type "
                    f"'{type(entity).__name__}' (expected '{expected}-…')"
                ),
                entity_id=entity.id,
            )
        ]
    return []


def _check_id_format(entity: WombatEntity) -> list[ValidationError]:
    """Verify the full ID is well-formed."""
    if not _WOMBAT_ID_RE.match(entity.id):
        return [
            ValidationError(
                field="id",
                message=f"ID '{entity.id}' does not match the required pattern",
                entity_id=entity.id,
            )
        ]
    return []


def _check_required_strings(entity: WombatEntity) -> list[ValidationError]:
    """Verify that required string fields are not empty."""
    errors: list[ValidationError] = []
    checks: list[tuple[str, str | None]] = [("title", entity.title)]
    if isinstance(entity, (TestCase, SharedStep, Story, Suite)):
        checks.append(("owner", entity.owner))
    if isinstance(entity, TestCase):
        checks.append(("component", entity.component))

    for fname, val in checks:
        if val is not None and val.strip() == "":
            errors.append(
                ValidationError(
                    field=fname,
                    message=f"Field '{fname}' must not be empty",
                    entity_id=entity.id,
                )
            )
    return errors


def validate_entity(entity: WombatEntity) -> ValidationResult:
    """Validate a single entity in isolation.

    Checks performed:
    * ID format is valid.
    * ID prefix matches the entity type.
    * Required string fields are non-empty.
    """
    errors: list[ValidationError] = []
    warnings: list[ValidationWarning] = []

    errors.extend(_check_id_format(entity))
    errors.extend(_check_id_prefix(entity))
    errors.extend(_check_required_strings(entity))

    return ValidationResult(valid=len(errors) == 0, errors=errors, warnings=warnings)


# ---------------------------------------------------------------------------
# Corpus-level validation
# ---------------------------------------------------------------------------


def _build_id_index(entities: list[WombatEntity]) -> dict[str, WombatEntity]:
    return {e.id: e for e in entities}


def _check_reference_integrity(
    entity: WombatEntity, id_index: dict[str, WombatEntity]
) -> list[ValidationError]:
    """Check that all referenced WombatIDs exist in the corpus."""
    errors: list[ValidationError] = []

    if isinstance(entity, TestCase):
        for ref in entity.shared_steps:
            if ref not in id_index:
                errors.append(
                    ValidationError(
                        field="shared_steps",
                        message=f"Referenced shared step '{ref}' not found in corpus",
                        entity_id=entity.id,
                    )
                )
        if entity.superseded_by and entity.superseded_by not in id_index:
            errors.append(
                ValidationError(
                    field="superseded_by",
                    message=f"superseded_by '{entity.superseded_by}' not found in corpus",
                    entity_id=entity.id,
                )
            )

    elif isinstance(entity, Suite):
        for ref in entity.cases:
            if ref not in id_index:
                errors.append(
                    ValidationError(
                        field="cases",
                        message=f"Referenced test case '{ref}' not found in corpus",
                        entity_id=entity.id,
                    )
                )

    elif isinstance(entity, Story):
        for ref in entity.linked_tests:
            if ref not in id_index:
                errors.append(
                    ValidationError(
                        field="linked_tests",
                        message=f"Referenced test case '{ref}' not found in corpus",
                        entity_id=entity.id,
                    )
                )

    return errors


def _check_duplicate_ids(entities: list[WombatEntity]) -> list[ValidationError]:
    seen: dict[str, str] = {}
    errors: list[ValidationError] = []
    for entity in entities:
        if entity.id in seen:
            errors.append(
                ValidationError(
                    field="id",
                    message=f"Duplicate ID '{entity.id}' (first seen at '{seen[entity.id]}')",
                    entity_id=entity.id,
                )
            )
        else:
            seen[entity.id] = entity.id
    return errors


def validate_corpus(entities: list[WombatEntity]) -> ValidationResult:
    """Validate a collection of entities together.

    In addition to per-entity checks this verifies:
    * No duplicate IDs across the corpus.
    * All cross-entity references resolve (reference integrity).
    """
    errors: list[ValidationError] = []
    warnings: list[ValidationWarning] = []

    # Per-entity checks
    for entity in entities:
        result = validate_entity(entity)
        errors.extend(result.errors)
        warnings.extend(result.warnings)

    # Corpus-level checks
    errors.extend(_check_duplicate_ids(entities))
    id_index = _build_id_index(entities)
    for entity in entities:
        errors.extend(_check_reference_integrity(entity, id_index))

    return ValidationResult(valid=len(errors) == 0, errors=errors, warnings=warnings)
