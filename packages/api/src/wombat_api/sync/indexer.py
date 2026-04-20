"""Indexer pipeline: resolve sources, hash, chunk, embed, upsert."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path

from wombat_api.database.repository import Repository, content_hash_for
from wombat_core.rag.chunking import chunk_markdown, chunk_text, should_chunk
from wombat_core.rag.embedders.base import Embedder
from wombat_core.rag.pdf import extract_pdf_text
from wombat_core.rag.sources import ResolvedFile, SourceResolver
from wombat_core.config.models import AppRepoSource, RagSourcesConfig


_AUTHORED_KIND_BY_DIR = {
    "testcases": "testcase",
    "shared-steps": "shared_step",
    "plans": "plan",
    "stories": "story",
    "suites": "suite",
}


@dataclass
class IndexerProgress:
    total: int = 0
    seen: int = 0
    embedded: int = 0
    skipped: int = 0
    errors: list[dict] = field(default_factory=list)


class Indexer:
    def __init__(
        self,
        repository: Repository,
        embedder: Embedder,
        batch_size: int,
        chunk_size_tokens: int,
        chunk_overlap_tokens: int,
    ) -> None:
        self._repo = repository
        self._embedder = embedder
        self._batch_size = batch_size
        self._chunk_size = chunk_size_tokens
        self._chunk_overlap = chunk_overlap_tokens

    async def sync_project(
        self,
        project_id: uuid.UUID,
        test_repo_root: Path,
        sources_root: Path,
        app_repos: list[AppRepoSource],
        docs_folder: str | None,
        on_progress=None,
    ) -> IndexerProgress:
        progress = IndexerProgress()
        resolver = SourceResolver(
            test_repo_root=test_repo_root,
            sources_root=sources_root,
            config=RagSourcesConfig(
                app_repos=app_repos,
                docs_folder=docs_folder,
                chunk_size_tokens=self._chunk_size,
                chunk_overlap_tokens=self._chunk_overlap,
            ),
        )

        files = list(resolver.iter_files())
        progress.total = len(files)
        seen_by_repo: dict[str, set[str]] = {}
        pending_embed: list[tuple[ResolvedFile, dict]] = []

        for rf in files:
            seen_by_repo.setdefault(rf.source_repo, set()).add(rf.source_path)
            try:
                parsed = self._parse_file(rf)
            except Exception as e:
                progress.errors.append({
                    "path": rf.source_path, "error": str(e),
                })
                continue
            if parsed is None:
                continue

            # Check content_hash to skip unchanged content.
            h = content_hash_for(parsed["body"])
            existing = None
            if parsed.get("wombat_id"):
                # Authored kinds: key by wombat_id.
                existing = await self._repo.get_content_by_wombat_id(
                    project_id, parsed["kind"], parsed["wombat_id"],
                )
            else:
                # Docs: key by source path.
                existing = await self._repo.get_content_by_path(
                    project_id, rf.source_repo, rf.source_path,
                )

            if existing is not None and existing.content_hash == h:
                # Unchanged — just refresh revision if it changed.
                if existing.source_revision != rf.revision:
                    existing.source_revision = rf.revision
                progress.skipped += 1
                continue

            pending_embed.append((rf, parsed))
            progress.seen += 1

        # Batched embedding
        for i in range(0, len(pending_embed), self._batch_size):
            batch = pending_embed[i : i + self._batch_size]
            embed_texts: list[str] = []
            chunks_per_item: list[list[str] | None] = []
            for rf, parsed in batch:
                if parsed["kind"] == "doc":
                    text = parsed["body"]["text"]
                    if should_chunk(text, max_tokens=self._chunk_size):
                        chs = chunk_markdown(
                            text, max_tokens=self._chunk_size,
                            overlap_tokens=self._chunk_overlap,
                        )
                        chunks_per_item.append(chs)
                        embed_texts.extend(chs)
                        continue
                    chunks_per_item.append(None)
                    embed_texts.append(text[:2000])
                else:
                    chunks_per_item.append(None)
                    embed_texts.append(_embed_text_for(parsed))
            vectors = await self._embedder.embed_batch(embed_texts)

            # Distribute vectors back
            v_iter = iter(vectors)
            for (rf, parsed), chs in zip(batch, chunks_per_item):
                if chs is None:
                    emb = next(v_iter)
                    row = await self._repo.upsert_content(
                        project_id=project_id,
                        kind=parsed["kind"],
                        wombat_id=parsed.get("wombat_id"),
                        title=parsed["title"],
                        tags=parsed.get("tags", []),
                        body=parsed["body"],
                        source_repo=rf.source_repo,
                        source_path=rf.source_path,
                        source_revision=rf.revision,
                        embedding=emb,
                    )
                    await self._repo.replace_chunks(row.id, [])
                else:
                    chunk_embs = [next(v_iter) for _ in chs]
                    row = await self._repo.upsert_content(
                        project_id=project_id,
                        kind=parsed["kind"],
                        wombat_id=None,
                        title=parsed["title"],
                        tags=parsed.get("tags", []),
                        body=parsed["body"],
                        source_repo=rf.source_repo,
                        source_path=rf.source_path,
                        source_revision=rf.revision,
                        embedding=None,
                    )
                    await self._repo.replace_chunks(
                        row.id,
                        [(t, v) for t, v in zip(chs, chunk_embs)],
                    )
                progress.embedded += 1
                if on_progress:
                    on_progress(progress)

        # Soft-delete missing
        for repo_name, seen in seen_by_repo.items():
            await self._repo.soft_delete_missing(project_id, repo_name, seen)

        return progress

    def _parse_file(self, rf: ResolvedFile) -> dict | None:
        """Parse file into {kind, wombat_id, title, tags, body}."""
        ext = rf.absolute_path.suffix.lower()
        if rf.source_repo == "test-repo" and ext == ".md":
            # Authored kinds: dispatch by first path segment.
            first = Path(rf.source_path).parts[0]
            kind = _AUTHORED_KIND_BY_DIR.get(first)
            if kind is None:
                return None
            from wombat_core.parsing import parse_markdown_file
            result = parse_markdown_file(rf.absolute_path)
            if not result.ok:
                raise ValueError(
                    f"Parse error in {rf.source_path}: {result.error}"
                )
            entity = result.entity
            body = entity.model_dump(mode="json")
            return {
                "kind": kind,
                "wombat_id": entity.id,
                "title": entity.title,
                "tags": getattr(entity, "tags", []),
                "body": body,
            }
        # Docs (either from docs/ folder or app-repo)
        if ext in (".md", ".txt"):
            text = rf.absolute_path.read_text(encoding="utf-8", errors="replace")
            title = _extract_title_from_markdown(text, rf.source_path)
            return {
                "kind": "doc",
                "wombat_id": None,
                "title": title,
                "tags": [],
                "body": {"text": text, "format": ext.lstrip(".")},
            }
        if ext == ".pdf":
            text = extract_pdf_text(rf.absolute_path)
            title = Path(rf.source_path).stem
            return {
                "kind": "doc",
                "wombat_id": None,
                "title": title,
                "tags": [],
                "body": {"text": text, "format": "pdf"},
            }
        return None


def _embed_text_for(parsed: dict) -> str:
    """Canonical embedding input for authored entities (truncated to 2000 chars)."""
    title = parsed.get("title", "")
    body = parsed.get("body", {})
    summary = body.get("summary") or ""
    steps = body.get("steps") or []
    step_text = " ".join(
        (s.get("description") or s.get("action") or "")
        for s in steps if isinstance(s, dict)
    )
    raw = f"{title}\n\n{summary}\n\n{step_text}".strip()
    return raw[:2000]


def _extract_title_from_markdown(text: str, fallback: str) -> str:
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("#"):
            return s.lstrip("# ").strip() or Path(fallback).stem
        if s:
            return s[:120]
    return Path(fallback).stem
