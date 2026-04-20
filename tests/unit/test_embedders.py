"""Tests for embedders."""

import pytest

from wombat_core.rag.embedders import load_embedder
from wombat_core.rag.embedders.base import Embedder


class FakeEmbedder(Embedder):
    name = "fake"
    dim = 4
    async def embed_batch(self, texts):
        return [[float(len(t)), 0.0, 0.0, 0.0] for t in texts]


@pytest.mark.asyncio
async def test_embedder_protocol_batch():
    e = FakeEmbedder()
    out = await e.embed_batch(["a", "bb"])
    assert len(out) == 2
    assert len(out[0]) == 4
    assert out[0][0] == 1.0
    assert out[1][0] == 2.0


@pytest.mark.asyncio
async def test_local_embedder_dim_matches_model(monkeypatch):
    """LocalEmbedder reports correct dim for bge-small-en-v1.5 (384)."""
    monkeypatch.setenv("WOMBAT_EMBEDDER_PROVIDER", "local")
    monkeypatch.setenv("WOMBAT_EMBEDDER_MODEL", "bge-small-en-v1.5")
    e = load_embedder()
    assert e.dim == 384


@pytest.mark.asyncio
async def test_openai_embedder_dim_declared(monkeypatch):
    monkeypatch.setenv("WOMBAT_EMBEDDER_PROVIDER", "openai")
    monkeypatch.setenv("WOMBAT_EMBEDDER_MODEL", "text-embedding-3-small")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    e = load_embedder()
    assert e.dim == 1536
    assert e.name.startswith("openai:")
