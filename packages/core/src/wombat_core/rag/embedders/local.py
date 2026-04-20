"""sentence-transformers-backed embedder."""

from __future__ import annotations

from functools import lru_cache

# Model -> dim mapping for the defaults we ship with. Extend as needed.
_KNOWN_DIMS = {
    "bge-small-en-v1.5": 384,
    "BAAI/bge-small-en-v1.5": 384,
    "all-MiniLM-L6-v2": 384,
    "nomic-embed-text-v1.5": 768,
}


class LocalEmbedder:
    def __init__(self, model: str = "bge-small-en-v1.5") -> None:
        self.name = f"local:{model}"
        self._model_name = model
        self.dim = _KNOWN_DIMS.get(model)
        if self.dim is None:
            self.dim = self._probe_dim()

    @lru_cache(maxsize=1)
    def _get_model(self):
        from sentence_transformers import SentenceTransformer
        return SentenceTransformer(self._model_name)

    def _probe_dim(self) -> int:
        return int(self._get_model().get_sentence_embedding_dimension())

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        import asyncio
        model = self._get_model()
        # sentence-transformers is synchronous; offload to a thread.
        return await asyncio.to_thread(
            lambda: model.encode(texts, normalize_embeddings=True).tolist()
        )
