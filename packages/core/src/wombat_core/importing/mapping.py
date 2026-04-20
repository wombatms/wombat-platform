"""Column mapping engine.

A ``MappingProfile`` describes how source columns (XLSX/CSV headers) map to
``TestCase`` fields.  Profiles are loaded from YAML or constructed in-code.

YAML schema
-----------
::

    name: my_profile
    columns:
      - source: "ID"
        target: "id"
        transform: "strip"          # optional: strip | lower | upper | split_comma
      - source: "Test Title"
        target: "title"
      - source: "Area Path"
        target: "component"
        transform: "area_path_last"   # use the last segment of an Azure-style path
    defaults:
      status: "draft"
      priority: "medium"
      owner: "unassigned"
      component: "general"

The ``target`` field uses the ``TestCase`` model field names.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

# ---------------------------------------------------------------------------
# Default mapping: handles common column names case-insensitively.
# ---------------------------------------------------------------------------

_DEFAULT_COLUMN_MAP: dict[str, str] = {
    # id
    "id": "id",
    "wombat_id": "id",
    "test id": "id",
    "testid": "id",
    # title
    "title": "title",
    "name": "title",
    "test name": "title",
    "test title": "title",
    "testname": "title",
    # component
    "component": "component",
    "area": "component",
    "area path": "component",
    "module": "component",
    "feature area": "component",
    # owner
    "owner": "owner",
    "assigned to": "owner",
    "assignee": "owner",
    # tags
    "tags": "tags",
    "labels": "tags",
    "tag": "tags",
    # summary
    "summary": "summary",
    "description": "summary",
    "details": "summary",
    # priority
    "priority": "priority",
    # status
    "status": "status",
    "state": "status",
    # type
    "type": "type",
    "test type": "type",
    "testtype": "type",
}


@dataclass
class ColumnMapping:
    """Maps a single source column to a target field."""

    source: str
    target: str
    transform: str | None = None  # strip | lower | upper | split_comma | area_path_last


@dataclass
class MappingProfile:
    """A complete column mapping profile."""

    name: str = "default"
    columns: list[ColumnMapping] = field(default_factory=list)
    defaults: dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_yaml(cls, path: Path) -> MappingProfile:
        with open(path) as fh:
            raw = yaml.safe_load(fh) or {}
        columns = [
            ColumnMapping(
                source=c["source"],
                target=c["target"],
                transform=c.get("transform"),
            )
            for c in raw.get("columns", [])
        ]
        return cls(
            name=raw.get("name", path.stem),
            columns=columns,
            defaults=raw.get("defaults", {}),
        )

    def build_index(self, headers: list[str]) -> dict[int, ColumnMapping]:
        """Return ``{column_index: ColumnMapping}`` for headers that match."""
        if self.columns:
            # Explicit mapping: match by source name (case-insensitive).
            source_map = {c.source.lower(): c for c in self.columns}
            idx: dict[int, ColumnMapping] = {}
            for i, h in enumerate(headers):
                cm = source_map.get(h.lower())
                if cm:
                    idx[i] = cm
            return idx
        else:
            # Default mapping: match headers against _DEFAULT_COLUMN_MAP.
            idx = {}
            for i, h in enumerate(headers):
                target = _DEFAULT_COLUMN_MAP.get(h.strip().lower())
                if target:
                    idx[i] = ColumnMapping(source=h, target=target)
            return idx

    def apply_transforms(self, col_map: ColumnMapping, value: str) -> object:
        """Apply optional transform to a string value."""
        if not value:
            return value
        t = col_map.transform
        if t == "strip" or t is None:
            return value.strip()
        if t == "lower":
            return value.strip().lower()
        if t == "upper":
            return value.strip().upper()
        if t == "split_comma":
            return [v.strip() for v in value.split(",") if v.strip()]
        if t == "area_path_last":
            # e.g. "MyProject\\Component\\SubComp" → "SubComp"
            for sep in ("\\", "/"):
                if sep in value:
                    return value.rsplit(sep, 1)[-1].strip()
            return value.strip()
        return value.strip()


def load_profile(name: str) -> MappingProfile:
    """Load a named built-in profile or return the default.

    Built-in profiles: ``'default'``, ``'azure_devops'``.
    """
    if name == "azure_devops":
        from wombat_core.importing.profiles.azure_devops import AZURE_DEVOPS_PROFILE

        return AZURE_DEVOPS_PROFILE
    # For any other name, fall back to the default auto-detect profile.
    return MappingProfile(name=name or "default")
