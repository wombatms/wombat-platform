"""Unit tests for the `wombat rag preview` CLI command.

Covers the local-mode error path (no Postgres URL) and the --help text.
Server-mode and live-Postgres tests are integration-only.
"""

from __future__ import annotations

import pytest
from typer.testing import CliRunner

from wombat_cli.main import app

runner = CliRunner()


class TestRagPreviewLocalMode:
    def test_local_no_db_exits_with_error(self, monkeypatch):
        """Without WOMBAT_DATABASE_URL set, rag preview should exit 1."""
        monkeypatch.delenv("WOMBAT_DATABASE_URL", raising=False)
        result = runner.invoke(app, ["rag", "preview", "refund test", "--project", "proj"])
        assert result.exit_code == 1
        assert "Postgres DB required" in result.output

    def test_local_non_postgres_url_exits(self, monkeypatch):
        """A SQLite URL (not postgresql) should also exit 1."""
        monkeypatch.setenv("WOMBAT_DATABASE_URL", "sqlite:///local.db")
        result = runner.invoke(app, ["rag", "preview", "query", "--project", "proj"])
        assert result.exit_code == 1
        assert "Postgres DB required" in result.output

    def test_rag_help_shows_preview_command(self):
        result = runner.invoke(app, ["rag", "--help"])
        assert result.exit_code == 0
        assert "preview" in result.output

    def test_rag_preview_help(self):
        result = runner.invoke(app, ["rag", "preview", "--help"])
        assert result.exit_code == 0
        assert "--mode" in result.output
        assert "--top-k" in result.output
        assert "--kind" in result.output
        assert "--server" in result.output
