"""OpenAI embeddings API embedder."""

from __future__ import annotations

import httpx


_MODEL_DIMS = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,
}


class OpenAIEmbedder:
    def __init__(self, api_key: str, model: str = "text-embedding-3-small"):
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for OpenAIEmbedder")
        self._api_key = api_key
        self._model = model
        self.name = f"openai:{model}"
        self.dim = _MODEL_DIMS.get(model)
        if self.dim is None:
            raise ValueError(f"Unknown OpenAI model: {model}")
        self._client = httpx.AsyncClient(timeout=60.0)

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        r = await self._client.post(
            "https://api.openai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={"model": self._model, "input": texts},
        )
        r.raise_for_status()
        data = r.json()["data"]
        # API returns sorted by index; be explicit.
        data.sort(key=lambda d: d["index"])
        return [d["embedding"] for d in data]
