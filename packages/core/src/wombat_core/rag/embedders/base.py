"""Embedder protocol."""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class Embedder(Protocol):
    name: str
    dim: int

    async def embed_batch(self, texts: list[str]) -> list[list[float]]: ...
