"""API config loaded from environment variables."""

from __future__ import annotations

import os
from functools import lru_cache
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Config:
    database_url: str
    jwt_secret: str
    jwt_access_minutes: int = 60
    jwt_refresh_days: int = 30
    debug: bool = False
    cors_origins: list[str] = field(default_factory=lambda: ["*"])
    embed_dim: int = 384                     # default matches bge-small-en-v1.5
    embedder_provider: str = "local"          # "local" | "openai"
    embedder_model: str = "bge-small-en-v1.5"
    openai_api_key: str | None = None
    # Working dir for cloned external source repos for RAG
    sources_root: str = ".wombat/sources"


@lru_cache
def get_config() -> Config:
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
        embedder_model=os.environ.get(
            "WOMBAT_EMBEDDER_MODEL", "bge-small-en-v1.5"
        ),
        openai_api_key=os.environ.get("OPENAI_API_KEY"),
        sources_root=os.environ.get("WOMBAT_SOURCES_ROOT", ".wombat/sources"),
    )
