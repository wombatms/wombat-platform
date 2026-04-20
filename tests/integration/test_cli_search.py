"""Integration tests for `wombat search`."""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from wombat_cli.main import app

from .conftest import parse_json_output


class TestSearchCommand:
    def test_search_finds_match_by_title(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["search", "login", "--directory", str(populated_project), "--json"],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["count"] >= 1
        assert any("login" in r.get("title", "").lower() for r in data["results"])

    def test_search_no_results(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "search",
                "zzz-no-match-xyz",
                "--directory",
                str(populated_project),
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["count"] == 0
        assert data["results"] == []

    def test_search_json_response_structure(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["search", "auth", "--directory", str(populated_project), "--json"],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert "query" in data
        assert "results" in data
        assert "count" in data
        assert data["query"] == "auth"

    def test_search_filter_by_type(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "search",
                "auth",
                "--directory",
                str(populated_project),
                "--type",
                "testcase",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert all(r["id"].startswith("TC-") for r in data["results"])

    def test_search_limit(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "search",
                "a",  # broad query to match many
                "--directory",
                str(populated_project),
                "--limit",
                "1",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert len(data["results"]) <= 1

    def test_search_by_component(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["search", "payments", "--directory", str(populated_project), "--json"],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["count"] >= 1

    def test_search_human_output_exits_0(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["search", "login", "--directory", str(populated_project)],
        )
        assert result.exit_code == 0

    def test_search_no_init_exits_1(self, runner: CliRunner, tmp_path: Path):
        result = runner.invoke(app, ["search", "anything", "--directory", str(tmp_path)])
        assert result.exit_code == 1
