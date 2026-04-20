"""Integration tests for `wombat create`."""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from wombat_cli.main import app

from .conftest import parse_json_output


class TestCreateCommand:
    def test_create_testcase_with_explicit_id(self, runner: CliRunner, project_dir: Path):
        result = runner.invoke(
            app,
            [
                "create",
                "testcase",
                "--id",
                "TC-AUTH-NEW-0001",
                "--title",
                "New test case",
                "--directory",
                str(project_dir),
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["entity"]["id"] == "TC-AUTH-NEW-0001"
        assert data["written"] is True

    def test_create_writes_file_to_disk(self, runner: CliRunner, project_dir: Path):
        runner.invoke(
            app,
            [
                "create",
                "testcase",
                "--id",
                "TC-AUTH-FILE-0001",
                "--title",
                "File write test",
                "--directory",
                str(project_dir),
            ],
        )
        tc_file = project_dir / ".wombat" / "testcases" / "TC-AUTH-FILE-0001.md"
        assert tc_file.exists()

    def test_create_plan(self, runner: CliRunner, project_dir: Path):
        result = runner.invoke(
            app,
            [
                "create",
                "plan",
                "--id",
                "PLAN-NEW-2026",
                "--title",
                "New release plan",
                "--directory",
                str(project_dir),
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["entity"]["id"] == "PLAN-NEW-2026"

    def test_create_story(self, runner: CliRunner, project_dir: Path):
        result = runner.invoke(
            app,
            [
                "create",
                "story",
                "--id",
                "STORY-NEW-FEATURE",
                "--title",
                "New feature story",
                "--directory",
                str(project_dir),
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["entity"]["id"] == "STORY-NEW-FEATURE"

    def test_create_auto_sequence_id(self, runner: CliRunner, project_dir: Path):
        # project_dir has auto_sequence: true
        result = runner.invoke(
            app,
            [
                "create",
                "testcase",
                "--title",
                "Auto-sequenced test case",
                "--directory",
                str(project_dir),
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["entity"]["id"].startswith("TC-")

    def test_create_dry_run_does_not_write(self, runner: CliRunner, project_dir: Path):
        result = runner.invoke(
            app,
            [
                "create",
                "testcase",
                "--id",
                "TC-AUTH-DRYRUN-0001",
                "--title",
                "Dry run test",
                "--directory",
                str(project_dir),
                "--dry-run",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert data["dry_run"] is True
        # File should NOT exist
        tc_file = project_dir / ".wombat" / "testcases" / "TC-AUTH-DRYRUN-0001.md"
        assert not tc_file.exists()

    def test_create_dry_run_json_has_entity(self, runner: CliRunner, project_dir: Path):
        result = runner.invoke(
            app,
            [
                "create",
                "testcase",
                "--id",
                "TC-AUTH-DR-0001",
                "--title",
                "Dry run check",
                "--directory",
                str(project_dir),
                "--dry-run",
                "--json",
            ],
        )
        assert result.exit_code == 0
        data = parse_json_output(result.output)
        assert "entity" in data

    def test_create_unknown_type_fails(self, runner: CliRunner, project_dir: Path):
        result = runner.invoke(
            app,
            [
                "create",
                "unknowntype",
                "--id",
                "XX-001",
                "--directory",
                str(project_dir),
            ],
        )
        assert result.exit_code != 0

    def test_create_no_id_no_auto_sequence_fails(self, runner: CliRunner, tmp_path: Path):
        # Create project with auto_sequence: false
        wombat_dir = tmp_path / ".wombat"
        wombat_dir.mkdir()
        (wombat_dir / "config.yaml").write_text("project:\n  id: test\n  name: Test\nid:\n  auto_sequence: false\n")
        for s in ["testcases", "shared-steps", "plans", "stories", "suites"]:
            (wombat_dir / s).mkdir()

        result = runner.invoke(
            app,
            ["create", "testcase", "--title", "No ID", "--directory", str(tmp_path)],
        )
        assert result.exit_code != 0

    def test_create_no_init_fails(self, runner: CliRunner, tmp_path: Path):
        result = runner.invoke(
            app,
            ["create", "testcase", "--id", "TC-001", "--directory", str(tmp_path)],
        )
        assert result.exit_code != 0
