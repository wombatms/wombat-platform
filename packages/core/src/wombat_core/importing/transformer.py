"""Row transformer — converts raw rows into TestCase Pydantic models.

Applies a ``MappingProfile`` to a set of ``(headers, rows)`` and returns an
``ImportResult``.

Design
------
* Each row is processed independently.
* Validation errors (Pydantic ``ValidationError``) are caught per-row; the row
  is appended to ``result.skipped`` and an entry is added to ``result.errors``.
* Rows with no ``id`` after mapping receive an auto-generated ``wombat_id``
  based on the row index (``TC-IMPORT-{n:04d}``).  This keeps the import
  idempotent *only* if the user supplies explicit IDs.
* The ``tags`` field accepts either a list (already split) or a
  comma-separated string.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import ValidationError

from wombat_core.importing.mapping import MappingProfile
from wombat_core.models.testcase import TestCase


def transform_rows(
    headers: list[str],
    rows: list[list],
    profile: MappingProfile,
) -> "wombat_core.importing.ImportResult":  # type: ignore[name-defined]  # lazy import
    from wombat_core.importing import ImportResult

    col_index = profile.build_index(headers)
    defaults = dict(profile.defaults)

    entities: list[TestCase] = []
    skipped: list[int] = []
    errors: list[dict] = []

    for row_idx, row in enumerate(rows, start=2):  # 1-based, row 1 = header
        try:
            tc = _transform_row(row, row_idx, col_index, profile, defaults)
            entities.append(tc)
        except Exception as exc:
            skipped.append(row_idx)
            errors.append({
                "row": row_idx,
                "message": str(exc),
            })

    return ImportResult(entities=entities, skipped=skipped, errors=errors)


def _transform_row(
    row: list,
    row_idx: int,
    col_index: dict,
    profile: MappingProfile,
    defaults: dict,
) -> TestCase:
    """Map a single raw row to a ``TestCase``."""
    data: dict = dict(defaults)

    for col_i, cm in col_index.items():
        raw = row[col_i] if col_i < len(row) else None
        if raw is None:
            continue
        val = _coerce_str(raw)
        transformed = profile.apply_transforms(cm, val)
        data[cm.target] = transformed

    # Ensure id is present — auto-generate if missing.
    if not data.get("id"):
        data["id"] = f"TC-IMPORT-{row_idx:04d}"

    # Ensure required fields have defaults.
    data.setdefault("title", f"Imported row {row_idx}")
    data.setdefault("component", "general")
    data.setdefault("owner", "unassigned")

    # Normalise tags: string → list.
    tags = data.get("tags", [])
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]
    data["tags"] = tags

    # Normalise priority: map numeric Azure DevOps priority to words.
    priority = data.get("priority")
    if priority is not None:
        data["priority"] = _normalise_priority(str(priority).strip())

    # Normalise status: map Azure DevOps states to wombat statuses.
    status = data.get("status")
    if status is not None:
        data["status"] = _normalise_status(str(status).strip())

    # summary is stored in the TestCase model directly.
    # Drop any None/empty values before validation so defaults kick in.
    data = {k: v for k, v in data.items() if v is not None and v != ""}

    try:
        return TestCase(**data)
    except ValidationError as exc:
        raise ValueError(f"Validation failed: {exc.errors(include_url=False)}") from exc


def _coerce_str(value: object) -> str:
    """Coerce any value to a stripped string."""
    if value is None:
        return ""
    return str(value).strip()


def _normalise_priority(value: str) -> str:
    """Map numeric or variant priority values to Wombat's vocabulary."""
    mapping = {
        "1": "critical",
        "2": "high",
        "3": "medium",
        "4": "low",
        "5": "low",
        "critical": "critical",
        "high": "high",
        "medium": "medium",
        "normal": "medium",
        "low": "low",
    }
    return mapping.get(value.lower(), "medium")


def _normalise_status(value: str) -> str:
    """Map variant status strings to Wombat's vocabulary."""
    mapping = {
        "active": "active",
        "ready": "active",
        "design": "draft",
        "draft": "draft",
        "closed": "archived",
        "archived": "archived",
        "deprecated": "archived",
    }
    return mapping.get(value.lower(), "draft")
