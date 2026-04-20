"""Embedder loader — config-driven selection."""

from __future__ import annotations

import os

from wombat_core.rag.embedders.base import Embedder
from wombat_core.rag.embedders.local import LocalEmbedder
from wombat_core.rag.embedders.openai import OpenAIEmbedder


def load_embedder() -> Embedder:
    provider = os.environ.get("WOMBAT_EMBEDDER_PROVIDER", "local")
    model = os.environ.get("WOMBAT_EMBEDDER_MODEL")
    if provider == "local":
        return LocalEmbedder(model or "bge-small-en-v1.5")
    if provider == "openai":
        return OpenAIEmbedder(
            api_key=os.environ.get("OPENAI_API_KEY", ""),
            model=model or "text-embedding-3-small",
        )
    raise ValueError(f"Unknown embedder provider: {provider}")
