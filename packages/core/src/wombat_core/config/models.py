"""Pydantic config models for RAG sources and related configuration.

These supplement the dataclass-based loader.py (SP1 config) with typed
Pydantic models for the `[rag.sources]` section of wombat.toml.
Backward compatible: existing configs without [rag.sources] load with defaults.
"""

from __future__ import annotations

from pydantic import BaseModel


class AppRepoSource(BaseModel):
    name: str  # "my-service"
    repo: str  # git URL
    ref: str = "main"
    include: list[str] = []  # glob patterns


class RagSourcesConfig(BaseModel):
    app_repos: list[AppRepoSource] = []
    docs_folder: str | None = None
    chunk_size_tokens: int = 500
    chunk_overlap_tokens: int = 50
