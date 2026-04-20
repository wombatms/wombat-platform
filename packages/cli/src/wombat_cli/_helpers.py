"""Thin coordination helpers — scan .wombat/ dirs and delegate to wombat_core."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from wombat_core.config.loader import WombatConfig
    from wombat_core.parsing.frontmatter import WombatEntity


# ---------------------------------------------------------------------------
# Directory resolution
# ---------------------------------------------------------------------------


def wombat_root(config: WombatConfig) -> Path | None:
    """Return the .wombat/ directory, or None if not initialised."""
    if config.config_path is None:
        return None
    return config.config_path.parent


# ---------------------------------------------------------------------------
# Entity lookup
# ---------------------------------------------------------------------------


def find_by_id(root: Path, entity_id: str) -> WombatEntity | None:
    """Scan *root* recursively and return the entity with *entity_id*, or None."""
    from wombat_core.search.local import search_files

    # entity_type from ID prefix
    prefix = entity_id.split("-", 1)[0]
    prefix_type_map = {
        "TC": "testcase",
        "SS": "shared_step",
        "PLAN": "plan",
        "STORY": "story",
        "SUITE": "suite",
    }
    entity_type = prefix_type_map.get(prefix)
    result = search_files(root, entity_type=entity_type, limit=10000)
    for entity in result.entities:
        if entity.id == entity_id:
            return entity
    return None


def find_file_for_id(root: Path, entity_id: str) -> Path | None:
    """Walk *root* and return the file path where *entity_id* is stored."""
    from wombat_core.parsing.frontmatter import parse_markdown_file
    from wombat_core.parsing.yaml_parser import parse_yaml_file

    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix == ".md":
            result = parse_markdown_file(path)
        elif suffix in {".yaml", ".yml"}:
            result = parse_yaml_file(path)
        else:
            continue
        if result.ok and result.entity and result.entity.id == entity_id:
            return path
    return None


# ---------------------------------------------------------------------------
# Collect all entities from a directory
# ---------------------------------------------------------------------------


def collect_all(root: Path) -> list[WombatEntity]:
    """Return all parseable entities under *root*."""
    from wombat_core.search.local import search_files

    result = search_files(root, limit=100_000)
    return result.entities


# ---------------------------------------------------------------------------
# Entity subdirectory resolution
# ---------------------------------------------------------------------------


def entity_subdir(root: Path, entity_type: str) -> Path:
    """Return the canonical subdirectory for storing an entity type."""
    subdir_map = {
        "testcase": "testcases",
        "test_case": "testcases",
        "shared_step": "shared-steps",
        "sharedstep": "shared-steps",
        "shared-step": "shared-steps",
        "plan": "plans",
        "story": "stories",
        "suite": "suites",
    }
    subdir = subdir_map.get(entity_type.lower(), entity_type.lower() + "s")
    path = root / subdir
    path.mkdir(parents=True, exist_ok=True)
    return path


# ---------------------------------------------------------------------------
# Auto-sequence ID generation
# ---------------------------------------------------------------------------


def next_sequence_id(root: Path, entity_type: str) -> str:
    """Return the next available auto-sequenced ID for *entity_type*."""
    prefix_map = {
        "testcase": "TC",
        "test_case": "TC",
        "shared_step": "SS",
        "sharedstep": "SS",
        "shared-step": "SS",
        "plan": "PLAN",
        "story": "STORY",
        "suite": "SUITE",
    }
    prefix = prefix_map.get(entity_type.lower(), entity_type.upper())
    entities = collect_all(root)
    existing_nums: list[int] = []
    for e in entities:
        if e.id.startswith(f"{prefix}-"):
            suffix = e.id[len(prefix) + 1 :]
            if suffix.isdigit():
                existing_nums.append(int(suffix))
    next_num = max(existing_nums, default=0) + 1
    return f"{prefix}-{next_num:03d}"
