"""Load and parse .wombat/config.yaml."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

import yaml

if TYPE_CHECKING:
    from wombat_core.config.models import RagSourcesConfig


@dataclass
class ProjectConfig:
    id: str = ""
    name: str = ""
    org: str = ""
    default_owner: str = ""


@dataclass
class TaxonomyConfig:
    components: list[str] = field(default_factory=list)
    environments: list[str] = field(default_factory=list)


@dataclass
class IDConfig:
    auto_sequence: bool = False


@dataclass
class LintConfig:
    rules: dict[str, object] = field(default_factory=dict)


@dataclass
class TemplatesConfig:
    directory: str = "templates/"


@dataclass
class WombatConfig:
    project: ProjectConfig = field(default_factory=ProjectConfig)
    taxonomy: TaxonomyConfig = field(default_factory=TaxonomyConfig)
    lint: LintConfig = field(default_factory=LintConfig)
    templates: TemplatesConfig = field(default_factory=TemplatesConfig)
    id: IDConfig = field(default_factory=IDConfig)
    config_path: Path | None = None
    # rag.sources section — parsed into RagSourcesConfig; None if not present.
    rag_sources: RagSourcesConfig | None = None


def _find_config_dir(start: Path) -> Path | None:
    """Walk up from start to find a .wombat/ directory."""
    current = start.resolve()
    while True:
        candidate = current / ".wombat" / "config.yaml"
        if candidate.is_file():
            return candidate
        parent = current.parent
        if parent == current:
            return None
        current = parent


def load_config(start_path: Path) -> WombatConfig:
    """Load config from .wombat/config.yaml, walking up from start_path."""
    config_file = _find_config_dir(start_path)
    if config_file is None:
        return WombatConfig()

    with open(config_file) as f:
        raw = yaml.safe_load(f) or {}

    project_raw = raw.get("project", {})
    taxonomy_raw = raw.get("taxonomy", {})
    lint_raw = raw.get("lint", {})
    templates_raw = raw.get("templates", {})
    id_raw = raw.get("id", {})

    # Parse optional [rag.sources] section — backward compatible.
    rag_raw = raw.get("rag", {})
    rag_sources_raw = rag_raw.get("sources")
    rag_sources = None
    if rag_sources_raw is not None:
        from wombat_core.config.models import AppRepoSource, RagSourcesConfig

        rag_sources = RagSourcesConfig(
            app_repos=[AppRepoSource(**src) for src in rag_sources_raw.get("app_repos", [])],
            docs_folder=rag_sources_raw.get("docs_folder"),
            chunk_size_tokens=rag_sources_raw.get("chunk_size_tokens", 500),
            chunk_overlap_tokens=rag_sources_raw.get("chunk_overlap_tokens", 50),
        )

    return WombatConfig(
        project=ProjectConfig(
            id=project_raw.get("id", ""),
            name=project_raw.get("name", ""),
            org=project_raw.get("org", ""),
            default_owner=project_raw.get("default_owner", ""),
        ),
        taxonomy=TaxonomyConfig(
            components=taxonomy_raw.get("components", []),
            environments=taxonomy_raw.get("environments", []),
        ),
        lint=LintConfig(rules=lint_raw.get("rules", {})),
        templates=TemplatesConfig(directory=templates_raw.get("directory", "templates/")),
        id=IDConfig(auto_sequence=id_raw.get("auto_sequence", False)),
        config_path=config_file,
        rag_sources=rag_sources,
    )
