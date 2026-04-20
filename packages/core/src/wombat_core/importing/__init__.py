"""wombat_core.importing — import XLSX/CSV into Wombat TestCase entities.

Column mapping (default)
------------------------
The default mapping handles common column names case-insensitively:

  Source column       → TestCase field
  ─────────────────────────────────────────────────────────
  id / wombat_id      → id (WombatID)
  title / name        → title
  component / area    → component
  owner / assigned_to → owner
  tags / labels       → tags (comma-separated → list)
  summary / description / description → summary
  priority            → priority
  status              → status
  type / test_type    → type

Built-in profiles
-----------------
* ``azure_devops`` — maps Azure DevOps Test Case export columns.

Usage
-----
::

    from wombat_core.importing import parse_file, ImportResult

    result = parse_file(Path("tests.xlsx"), profile_name="azure_devops")
    for entity in result.entities:
        ...  # TestCase instances

The returned ``ImportResult`` also contains ``skipped`` (row indices) and
``errors`` (list of dicts with keys ``row``, ``message``).

Import flow for the MVP
-----------------------
``wombat import`` → ``parse_file()`` → write Markdown files via
``wombat_core.parsing.writer.write_entity`` → user commits → ``wombat sync``
picks them up.  The import module does **not** write to the database directly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from wombat_core.models.testcase import TestCase

from wombat_core.importing.parser import parse_xlsx, parse_csv
from wombat_core.importing.mapping import MappingProfile, load_profile
from wombat_core.importing.transformer import transform_rows


@dataclass
class ImportResult:
    """Result of parsing an import file."""

    entities: list[TestCase] = field(default_factory=list)
    skipped: list[int] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)


def parse_file(
    path: Path,
    *,
    profile_name: str = "default",
    mapping_file: Path | None = None,
) -> ImportResult:
    """Parse an XLSX or CSV file and return an ``ImportResult``.

    Parameters
    ----------
    path:
        Path to the XLSX or CSV file.
    profile_name:
        Name of a built-in mapping profile (``'default'`` or ``'azure_devops'``)
        or any string if ``mapping_file`` is also supplied.
    mapping_file:
        Optional path to a YAML mapping file.  Takes precedence over
        ``profile_name`` if provided.
    """
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xlsm", ".xltx", ".xltm"):
        headers, rows = parse_xlsx(path)
    elif suffix == ".csv":
        headers, rows = parse_csv(path)
    else:
        raise ValueError(
            f"Unsupported file type '{suffix}'. "
            "Supported: .xlsx, .xlsm, .xltx, .xltm, .csv"
        )

    if mapping_file is not None:
        profile = MappingProfile.from_yaml(mapping_file)
    else:
        profile = load_profile(profile_name)

    return transform_rows(headers, rows, profile)


def apply_profile(rows: list[dict], profile: MappingProfile) -> ImportResult:
    """Apply a mapping profile to pre-parsed rows (for re-use in tests)."""
    headers = list(rows[0].keys()) if rows else []
    raw_rows = [list(r.values()) for r in rows]
    return transform_rows(headers, raw_rows, profile)
