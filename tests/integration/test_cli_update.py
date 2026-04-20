"""Integration tests for `wombat update`."""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from wombat_cli.main import app

from .conftest import parse_json_output


class TestUpdateCommand:
    def test_update_title_field(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "update", "TC-AUTH-LOGIN-0001",
                "--set", "title=Updated login title",
                "--directory", str(populated_project),
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["entity"]["title"] == "Updated login title"

    def test_update_increments_version(self, runner: CliRunner, populated_project: Path):
        # First get current version via show
        show_result = runner.invoke(
            app,
            ["show", "TC-AUTH-LOGIN-0001", "--directory", str(populated_project), "--json"],
        )
        original_version = parse_json_output(show_result.output).get("version", 1)

        result = runner.invoke(
            app,
            [
                "update", "TC-AUTH-LOGIN-0001",
                "--set", "priority=critical",
                "--directory", str(populated_project),
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["version"] == original_version + 1

    def test_update_persists_to_disk(self, runner: CliRunner, populated_project: Path):
        runner.invoke(
            app,
            [
                "update", "TC-AUTH-LOGIN-0001",
                "--set", "summary=Updated summary value",
                "--directory", str(populated_project),
            ],
        )
        # Read back via show
        show_result = runner.invoke(
            app,
            ["show", "TC-AUTH-LOGIN-0001", "--directory", str(populated_project), "--json"],
        )
        data = parse_json_output(show_result.output)
        assert data["summary"] == "Updated summary value"

    def test_update_with_change_reason(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "update", "TC-AUTH-LOGIN-0001",
                "--set", "status=deprecated",
                "--reason", "Superseded by new test",
                "--directory", str(populated_project),
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["entity"]["change_reason"] == "Superseded by new test"

    def test_update_dry_run_does_not_persist(self, runner: CliRunner, populated_project: Path):
        runner.invoke(
            app,
            [
                "update", "TC-AUTH-LOGIN-0001",
                "--set", "summary=Should not persist",
                "--directory", str(populated_project),
                "--dry-run",
            ],
        )
        # Read back and check summary unchanged
        show_result = runner.invoke(
            app,
            ["show", "TC-AUTH-LOGIN-0001", "--directory", str(populated_project), "--json"],
        )
        data = parse_json_output(show_result.output)
        assert data.get("summary") != "Should not persist"

    def test_update_dry_run_json(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            [
                "update", "TC-AUTH-LOGIN-0001",
                "--set", "priority=low",
                "--directory", str(populated_project),
                "--dry-run",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["dry_run"] is True
        assert "entity" in data

    def test_update_nonexistent_entity_exits_3(
        self, runner: CliRunner, populated_project: Path
    ):
        result = runner.invoke(
            app,
            [
                "update", "TC-NONEXISTENT-9999",
                "--set", "title=Whatever",
                "--directory", str(populated_project),
            ],
        )
        assert result.exit_code == 3

    def test_update_invalid_set_expression(
        self, runner: CliRunner, populated_project: Path
    ):
        result = runner.invoke(
            app,
            [
                "update", "TC-AUTH-LOGIN-0001",
                "--set", "no-equals-sign",
                "--directory", str(populated_project),
            ],
        )
        assert result.exit_code != 0

    def test_update_no_init_exits_1(self, runner: CliRunner, tmp_path: Path):
        result = runner.invoke(
            app,
            ["update", "TC-001", "--set", "title=X", "--directory", str(tmp_path)],
        )
        assert result.exit_code == 1

    def test_update_json_response_has_path(
        self, runner: CliRunner, populated_project: Path
    ):
        result = runner.invoke(
            app,
            [
                "update", "TC-AUTH-LOGIN-0001",
                "--set", "priority=high",
                "--directory", str(populated_project),
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert "path" in data
        assert "written" in data
        assert data["written"] is True
