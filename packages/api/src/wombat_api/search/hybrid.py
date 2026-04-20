"""Hybrid cosine + BM25 retrieval over the unified content table.

Backend portability
-------------------
The full hybrid and keyword modes use Postgres-specific features:

* ``embedding <=> :vec`` — pgvector cosine distance operator.
* ``ts_rank_cd(fts, plainto_tsquery(...))`` — Postgres full-text search.

Under SQLite (used for unit tests), only ``mode='semantic'`` is supported via a
pure-ORM path that performs a dot-product approximation in Python.  Requesting
``mode='keyword'`` or ``mode='hybrid'`` on a non-Postgres session raises
``NotImplementedError`` with a clear message.

The dialect is detected via ``session.bind.dialect.name`` at query time so the
same code path works in both environments without changing the call site.
"""

from __future__ import annotations

import uuid
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.database.models import Content, ContentChunk

W_COS = 0.7
W_BM25 = 0.3


def blend(
    cos: float,
    bm25: float,
    w_cos: float = W_COS,
    w_bm25: float = W_BM25,
) -> float:
    """Combine a cosine similarity score and a BM25 rank score into one hybrid score.

    This pure-Python function mirrors the weighted sum used in the Postgres query
    (``w_cos * cos_score + w_bm * bm25_score``).  Keeping the arithmetic here
    means the test suite can verify the blend weights without Postgres.

    Args:
        cos:   Cosine similarity in [0, 1] (1.0 − pgvector cosine distance).
        bm25:  BM25 ts_rank_cd score (non-negative; typically < 1 for short queries).
        w_cos: Weight for the cosine term (default 0.7).
        w_bm25: Weight for the BM25 term (default 0.3).

    Returns:
        Combined score as a float.
    """
    return w_cos * cos + w_bm25 * bm25


async def hybrid_search(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    query: str,
    query_embedding: list[float],
    kinds: list[str] | None = None,
    tags: list[str] | None = None,
    top_k: int = 10,
    mode: Literal["hybrid", "semantic", "keyword"] = "hybrid",
    include_chunks: bool = True,
) -> list[dict]:
    """Run a hybrid semantic + keyword search.

    Returns a list of hit dicts sorted by descending score, truncated to top_k.
    """
    # Detect backend dialect.
    is_postgres = _is_postgres(session)

    if mode in ("keyword", "hybrid") and not is_postgres:
        raise NotImplementedError(
            f"mode='{mode}' requires Postgres (pgvector + FTS). "
            "Use mode='semantic' for SQLite-backed tests, or run against Postgres."
        )

    if is_postgres:
        return await _postgres_search(
            session,
            project_id=project_id,
            query=query,
            query_embedding=query_embedding,
            kinds=kinds,
            tags=tags,
            top_k=top_k,
            mode=mode,
            include_chunks=include_chunks,
        )
    else:
        # SQLite fallback — semantic mode only.
        return await _sqlite_semantic_search(
            session,
            project_id=project_id,
            query_embedding=query_embedding,
            kinds=kinds,
            tags=tags,
            top_k=top_k,
            include_chunks=include_chunks,
        )


def _is_postgres(session: AsyncSession) -> bool:
    """Return True when the session's underlying dialect is PostgreSQL."""
    try:
        # Sync bind is available on the underlying sync engine.
        bind = session.get_bind()
        return bind.dialect.name == "postgresql"
    except Exception:
        pass
    # Fallback: inspect the engine URL string.
    try:
        url = str(session.bind.url)  # type: ignore[attr-defined]
        return "postgresql" in url or "postgres" in url
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Postgres path
# ---------------------------------------------------------------------------


async def _postgres_search(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    query: str,
    query_embedding: list[float],
    kinds: list[str] | None,
    tags: list[str] | None,
    top_k: int,
    mode: str,
    include_chunks: bool,
) -> list[dict]:
    from sqlalchemy import literal_column

    # Build base filters.
    conds = [
        Content.project_id == project_id,
        Content.deleted_at.is_(None),
        Content.embedding.is_not(None),
    ]
    if kinds:
        conds.append(Content.kind.in_(kinds))
    if tags:
        for t in tags:
            conds.append(Content.tags.contains([t]))

    # Score expressions.
    # pgvector: Content.embedding.cosine_distance(...) returns a float column.
    cos_score = (literal_column("1.0") - Content.embedding.cosine_distance(query_embedding)).label("cos_score")

    ts_query_expr = func.plainto_tsquery("english", query)
    bm25_score = func.ts_rank_cd(literal_column("fts"), ts_query_expr).label("bm25_score")

    w_cos = W_COS if mode in ("hybrid", "semantic") else 0.0
    w_bm = W_BM25 if mode in ("hybrid", "keyword") else 0.0
    # Use the same arithmetic as the pure-Python blend() helper so that the
    # test suite can verify the weights without Postgres.
    combined = (w_cos * cos_score + w_bm * bm25_score).label("score")

    q = select(Content, cos_score, bm25_score, combined).where(*conds).order_by(combined.desc()).limit(top_k)
    rows = (await session.execute(q)).all()

    hits: list[dict] = []
    for c, _cs, _bs, sc in rows:
        hits.append(_content_hit(c, float(sc)))

    # Chunk-level hits for docs.
    if include_chunks and (not kinds or "doc" in kinds):
        chunk_hits = await _chunk_search_postgres(
            session,
            project_id=project_id,
            query_embedding=query_embedding,
            top_k=top_k,
        )
        hits.extend(chunk_hits)

    hits.sort(key=lambda h: h["score"], reverse=True)
    return hits[:top_k]


async def _chunk_search_postgres(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    query_embedding: list[float],
    top_k: int,
) -> list[dict]:
    from sqlalchemy import literal_column

    chunk_cos = (literal_column("1.0") - ContentChunk.embedding.cosine_distance(query_embedding)).label("cos_score")

    qc = (
        select(ContentChunk, Content, chunk_cos)
        .join(Content, Content.id == ContentChunk.content_id)
        .where(
            Content.project_id == project_id,
            Content.deleted_at.is_(None),
            Content.kind == "doc",
            ContentChunk.embedding.is_not(None),
        )
        .order_by(chunk_cos.desc())
        .limit(top_k)
    )
    crows = (await session.execute(qc)).all()
    hits: list[dict] = []
    for ch, parent, cs in crows:
        hits.append(
            {
                "id": str(parent.id),
                "kind": "doc",
                "wombat_id": parent.wombat_id,
                "title": parent.title,
                "score": float(cs) * W_COS,
                "snippet": ch.text[:280],
                "chunk_index": ch.chunk_index,
                "source": {
                    "repo": parent.source_repo,
                    "path": parent.source_path,
                    "revision": parent.source_revision,
                },
            }
        )
    return hits


# ---------------------------------------------------------------------------
# SQLite fallback (semantic only, Python-side dot product approximation)
# ---------------------------------------------------------------------------


async def _sqlite_semantic_search(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    query_embedding: list[float],
    kinds: list[str] | None,
    tags: list[str] | None,
    top_k: int,
    include_chunks: bool,
) -> list[dict]:
    """Pure-ORM semantic search for SQLite (unit tests).

    Fetches all content rows with a non-null embedding and computes cosine
    similarity in Python.  Only suitable for small in-memory test datasets.
    """
    import json as _json

    conds = [
        Content.project_id == project_id,
        Content.deleted_at.is_(None),
    ]
    if kinds:
        conds.append(Content.kind.in_(kinds))
    # Tag containment: under SQLite the JSON column is stored as text, so we
    # skip the tag filter here for simplicity (test data is small).

    rows = list((await session.execute(select(Content).where(*conds))).scalars())

    scored: list[tuple[float, Content]] = []
    for row in rows:
        emb = row.embedding
        if emb is None:
            continue
        # Embeddings may be stored as a list or JSON string under SQLite.
        if isinstance(emb, str):
            emb = _json.loads(emb)
        score = _cosine(query_embedding, emb)
        scored.append((score, row))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [_content_hit(c, s) for s, c in scored[:top_k]]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _cosine(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two float vectors."""
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    mag_a = sum(x * x for x in a) ** 0.5
    mag_b = sum(x * x for x in b) ** 0.5
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def _content_hit(c: Content, score: float) -> dict:
    body = c.body or {}
    snippet = (body.get("summary") or c.title or "")[:280]
    return {
        "id": str(c.id),
        "kind": c.kind,
        "wombat_id": c.wombat_id,
        "title": c.title,
        "score": score,
        "snippet": snippet,
        "source": {
            "repo": c.source_repo,
            "path": c.source_path,
            "revision": c.source_revision,
        },
    }
