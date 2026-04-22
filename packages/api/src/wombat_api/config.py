"""API config loaded from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class EvidenceConfig:
    """Configuration for the pluggable evidence-blob storage backend.

    Matches spec §6.3.  Set via ``WOMBAT_EVIDENCE_*`` env vars or nested in
    the app container config.
    """

    backend: Literal["localfs", "s3"] = "localfs"
    # LocalFS settings
    root: Path = field(default_factory=lambda: Path("./var/evidence"))
    signing_key: str | None = None
    # Shared cap
    max_file_mb: int = 25
    # S3 settings (all optional; required only when backend == "s3")
    bucket: str | None = None
    region: str | None = None
    endpoint_url: str | None = None
    prefix: str = "evidence/"


@dataclass(frozen=True)
class Config:
    database_url: str
    jwt_secret: str
    jwt_access_minutes: int = 60
    jwt_refresh_days: int = 30
    debug: bool = False
    cors_origins: list[str] = field(default_factory=lambda: ["*"])
    embed_dim: int = 384  # default matches bge-small-en-v1.5
    embedder_provider: str = "local"  # "local" | "openai"
    embedder_model: str = "bge-small-en-v1.5"
    openai_api_key: str | None = None
    # Working dir for cloned external source repos for RAG
    sources_root: str = ".wombat/sources"
    # Working dir for per-project Git working clones used by the publisher
    git_workspace_root: str = ".wombat/workspace"
    # Evidence blob storage
    evidence: EvidenceConfig = field(default_factory=EvidenceConfig)


@lru_cache
def get_config() -> Config:
    evidence = EvidenceConfig(
        backend=os.environ.get("WOMBAT_EVIDENCE_BACKEND", "localfs"),  # type: ignore[arg-type]
        root=Path(os.environ.get("WOMBAT_EVIDENCE_ROOT", "./var/evidence")),
        signing_key=os.environ.get("WOMBAT_EVIDENCE_SIGNING_KEY"),
        max_file_mb=int(os.environ.get("WOMBAT_EVIDENCE_MAX_FILE_MB", 25)),
        bucket=os.environ.get("WOMBAT_EVIDENCE_BUCKET"),
        region=os.environ.get("WOMBAT_EVIDENCE_REGION"),
        endpoint_url=os.environ.get("WOMBAT_EVIDENCE_ENDPOINT_URL"),
        prefix=os.environ.get("WOMBAT_EVIDENCE_PREFIX", "evidence/"),
    )
    return Config(
        database_url=os.environ.get(
            "WOMBAT_DATABASE_URL",
            "postgresql+asyncpg://wombat:wombat@localhost:5432/wombat",
        ),
        jwt_secret=os.environ.get("WOMBAT_JWT_SECRET", "change-me-in-prod"),
        jwt_access_minutes=int(os.environ.get("WOMBAT_JWT_ACCESS_MINUTES", 60)),
        jwt_refresh_days=int(os.environ.get("WOMBAT_JWT_REFRESH_DAYS", 30)),
        debug=os.environ.get("WOMBAT_DEBUG", "0") == "1",
        cors_origins=os.environ.get("WOMBAT_CORS_ORIGINS", "*").split(","),
        embed_dim=int(os.environ.get("WOMBAT_EMBED_DIM", 384)),
        embedder_provider=os.environ.get("WOMBAT_EMBEDDER_PROVIDER", "local"),
        embedder_model=os.environ.get("WOMBAT_EMBEDDER_MODEL", "bge-small-en-v1.5"),
        openai_api_key=os.environ.get("OPENAI_API_KEY"),
        sources_root=os.environ.get("WOMBAT_SOURCES_ROOT", ".wombat/sources"),
        git_workspace_root=os.environ.get("WOMBAT_GIT_WORKSPACE_ROOT", ".wombat/workspace"),
        evidence=evidence,
    )
