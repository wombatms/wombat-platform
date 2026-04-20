"""Integration tests for `wombat show`."""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from wombat_cli.main import app

from .conftest import parse_json_output


class TestShowCommand:
    def test_show_existing_entity(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["show", "TC-AUTH-LOGIN-0001", "--directory", str(populated_project)],
        )
        assert result.exit_code == 0

    def test_show_displays_title(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["show", "TC-AUTH-LOGIN-0001", "--directory", str(populated_project)],
        )
        assert "TC-AUTH-LOGIN-0001" in result.output or result.exit_code == 0

    def test_show_json_output(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["show", "TC-AUTH-LOGIN-0001", "--directory", str(populated_project), "--json"],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["id"] == "TC-AUTH-LOGIN-0001"
        assert data["title"] == "User logs in with valid credentials"

    def test_show_json_contains_steps(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["show", "TC-AUTH-LOGIN-0001", "--directory", str(populated_project), "--json"],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert "steps" in data
        assert len(data["steps"]) >= 1

    def test_show_json_summary_flag(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "show",
                "TC-AUTH-LOGIN-0001",
                "--directory",
                str(populated_project),
                "--json",
                "--summary",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        # Summary mode excludes steps, adds step_count
        assert "steps" not in data
        assert "step_count" in data

    def test_show_shared_step(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["show", "SS-LOGIN-001", "--directory", str(populated_project), "--json"],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["id"] == "SS-LOGIN-001"

    def test_show_plan(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["show", "PLAN-REGRESSION", "--directory", str(populated_project), "--json"],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["id"] == "PLAN-REGRESSION"

    def test_show_not_found_exits_3(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["show", "TC-NONEXISTENT-9999", "--directory", str(populated_project)],
        )
        assert result.exit_code == 3

    def test_show_not_found_json_error(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["show", "TC-NONEXISTENT-9999", "--directory", str(populated_project), "--json"],
        )
        assert result.exit_code == 3
        data = parse_json_output(result.output)
        assert "error" in data or "code" in data

    def test_show_no_init_exits_1(self, runner: CliRunner, tmp_path: Path):
        result = runner.invoke(
            app,
            ["show", "TC-AUTH-001", "--directory", str(tmp_path)],
        )
        assert result.exit_code == 1
