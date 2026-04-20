"""Integration tests for `wombat list`."""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from wombat_cli.main import app

from .conftest import parse_json_output


class TestListCommand:
    def test_list_returns_all_entities(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app, ["list", "--directory", str(populated_project), "--json"]
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["count"] >= 5  # 2 TCs + 1 SS + 1 Plan + 1 Story

    def test_list_filter_by_component(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "list",
                "--directory", str(populated_project),
                "--component", "auth",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert all(r.get("component") == "auth" for r in data["results"])

    def test_list_filter_by_type(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "list",
                "--directory", str(populated_project),
                "--type", "testcase",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["count"] == 2
        assert all(r["id"].startswith("TC-") for r in data["results"])

    def test_list_filter_by_owner(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "list",
                "--directory", str(populated_project),
                "--owner", "qa-auth-team",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["count"] >= 1

    def test_list_ids_only(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "list",
                "--directory", str(populated_project),
                "--type", "testcase",
                "--ids-only",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        # ids-only returns a list of ID strings
        assert isinstance(data, list)
        assert all(isinstance(item, str) for item in data)

    def test_list_count_only(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "list",
                "--directory", str(populated_project),
                "--type", "testcase",
                "--count",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["count"] == 2

    def test_list_pagination_limit(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "list",
                "--directory", str(populated_project),
                "--limit", "1",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert len(data["results"]) <= 1

    def test_list_pagination_offset(self, runner: CliRunner, populated_project: Path):
        result_all = runner.invoke(
            app,
            ["list", "--directory", str(populated_project), "--json"],
        )
        all_data = parse_json_output(result_all.output)
        total = all_data["count"]

        result_paged = runner.invoke(
            app,
            ["list", "--directory", str(populated_project), "--offset", "2", "--json"],
        )
        assert result_paged.exit_code == 0
        paged_data = parse_json_output(result_paged.output)
        assert len(paged_data["results"]) == total - 2

    def test_list_human_output_exits_0(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app, ["list", "--directory", str(populated_project)]
        )
        assert result.exit_code == 0

    def test_list_no_init_exits_1(self, runner: CliRunner, tmp_path: Path):
        result = runner.invoke(app, ["list", "--directory", str(tmp_path)])
        assert result.exit_code == 1

    def test_list_filter_by_tags(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "list",
                "--directory", str(populated_project),
                "--tags", "smoke",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["count"] >= 1

    def test_list_json_response_has_pagination_fields(
        self, runner: CliRunner, populated_project: Path
    ):
        result = runner.invoke(
            app, ["list", "--directory", str(populated_project), "--json"]
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert "count" in data
        assert "limit" in data
        assert "offset" in data
        assert "results" in data
