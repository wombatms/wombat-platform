"""Multi-source git resolver: test-repo + configured app-repos + docs folder."""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Iterator

from wombat_core.config.models import RagSourcesConfig


@dataclass(frozen=True)
class ResolvedFile:
    source_repo: str           # "test-repo" | "app-repo:<name>" | "docs"
    absolute_path: Path
    source_path: str           # path relative to source root
    revision: str              # current HEAD sha of the source repo


class SourceResolver:
    """Resolves + pulls all configured sources; yields files for indexing."""

    def __init__(
        self,
        test_repo_root: Path,
        sources_root: Path,
        config: RagSourcesConfig,
    ) -> None:
        self._test_repo = test_repo_root
        self._sources_root = sources_root
        self._config = config

    def iter_files(self) -> Iterator[ResolvedFile]:
        # 1. test-repo: enumerate standard fixture dirs
        test_rev = _git_head(self._test_repo)
        for sub in ("testcases", "shared-steps", "plans", "stories", "suites"):
            root = self._test_repo / sub
            if not root.exists():
                continue
            for p in root.rglob("*.md"):
                yield ResolvedFile(
                    source_repo="test-repo",
                    absolute_path=p,
                    source_path=str(p.relative_to(self._test_repo)),
                    revision=test_rev,
                )

        # 2. docs folder, if configured
        if self._config.docs_folder:
            docs_root = self._test_repo / self._config.docs_folder
            if docs_root.exists():
                for p in docs_root.rglob("*"):
                    if not p.is_file():
                        continue
                    if p.suffix.lower() not in (".md", ".txt", ".pdf"):
                        continue
                    yield ResolvedFile(
                        source_repo="docs",
                        absolute_path=p,
                        source_path=str(p.relative_to(self._test_repo)),
                        revision=test_rev,
                    )

        # 3. app-repos
        for src in self._config.app_repos:
            local = self._sources_root / src.name
            _ensure_clone(local, src.repo, src.ref)
            rev = _git_head(local)
            for p in local.rglob("*"):
                if not p.is_file():
                    continue
                if p.suffix.lower() not in (".md", ".txt", ".pdf"):
                    continue
                rel = str(p.relative_to(local))
                if src.include and not _matches_any(rel, src.include):
                    continue
                yield ResolvedFile(
                    source_repo=f"app-repo:{src.name}",
                    absolute_path=p,
                    source_path=rel,
                    revision=rev,
                )


def _matches_any(path: str, globs: list[str]) -> bool:
    return any(fnmatch.fnmatch(path, g) for g in globs)


def _git_head(root: Path) -> str:
    try:
        from git import Repo
        return Repo(str(root)).head.commit.hexsha
    except Exception:
        # test-repo may not be a git repo in test fixtures
        return "unknown"


def _ensure_clone(local: Path, repo_url: str, ref: str) -> None:
    from git import Repo
    if local.exists():
        Repo(str(local)).remotes.origin.fetch()
        Repo(str(local)).git.checkout(ref)
        Repo(str(local)).remotes.origin.pull()
    else:
        local.parent.mkdir(parents=True, exist_ok=True)
        Repo.clone_from(repo_url, str(local), depth=1, branch=ref)
