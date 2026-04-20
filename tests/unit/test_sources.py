"""Tests for multi-source git resolution."""

from pathlib import Path

from wombat_core.config.models import RagSourcesConfig
from wombat_core.rag.sources import SourceResolver


def test_test_repo_always_resolved(tmp_path: Path):
    test_repo = tmp_path / "test-repo"
    test_repo.mkdir()
    (test_repo / "testcases").mkdir()
    (test_repo / "testcases/tc-1.md").write_text("---\nid: tc-1\n---\nhi")

    resolver = SourceResolver(
        test_repo_root=test_repo,
        sources_root=tmp_path / ".wombat/sources",
        config=RagSourcesConfig(),
    )
    results = list(resolver.iter_files())
    # At least the single testcase file should surface under "test-repo".
    test_repo_files = [r for r in results if r.source_repo == "test-repo"]
    assert any(r.source_path.endswith("tc-1.md") for r in test_repo_files)


def test_docs_folder_surfaces_docs(tmp_path: Path):
    test_repo = tmp_path / "test-repo"
    (test_repo / "docs").mkdir(parents=True)
    (test_repo / "docs/policy.md").write_text("# Policy\nsome content")

    resolver = SourceResolver(
        test_repo_root=test_repo,
        sources_root=tmp_path / ".wombat/sources",
        config=RagSourcesConfig(docs_folder="docs"),
    )
    results = list(resolver.iter_files())
    docs_files = [r for r in results if r.source_repo == "docs"]
    assert any(r.source_path.endswith("policy.md") for r in docs_files)
