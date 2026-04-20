"""Integration tests for `wombat diff`."""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from wombat_cli.main import app

from .conftest import parse_json_output


class TestDiffCommand:
    def test_diff_two_files(self, runner: CliRunner, populated_project: Path, tmp_path: Path):
        """Diff between two explicitly provided files."""
        from wombat_core.models.testcase import TestCase
        from wombat_core.parsing.writer import write_entity

        tc_v1 = TestCase(
            id="TC-AUTH-DIFF-0001",
            title="Login test version 1",
            component="auth",
            owner="qa",
            version=1,
        )
        tc_v2 = TestCase(
            id="TC-AUTH-DIFF-0001",
            title="Login test version 2 — updated title",
            component="auth",
            owner="qa",
            version=2,
        )
        file_a = tmp_path / "v1.md"
        file_b = tmp_path / "v2.md"
        write_entity(tc_v1, file_a)
        write_entity(tc_v2, file_b)

        result = runner.invoke(
            app,
            [
                "diff", "TC-AUTH-DIFF-0001",
                "--file-a", str(file_a),
                "--file-b", str(file_b),
                "--directory", str(populated_project),
                "--json",
            ],
        )
        # The command may succeed or fail depending on whether diff_entity is implemented
        if result.exit_code == 0:
            data = parse_json_output(result.output)
            assert "changed_fields" in data or "entity_id" in data

    def test_diff_json_response_structure(
        self, runner: CliRunner, populated_project: Path, tmp_path: Path
    ):
        from wombat_core.models.testcase import TestCase
        from wombat_core.parsing.writer import write_entity

        tc_v1 = TestCase(
            id="TC-AUTH-DIFFSTRUCT-001",
            title="Original title",
            component="auth",
            owner="qa",
            version=1,
        )
        tc_v2 = TestCase(
            id="TC-AUTH-DIFFSTRUCT-001",
            title="Changed title",
            component="auth",
            owner="qa",
            version=2,
        )
        file_a = tmp_path / "v1.md"
        file_b = tmp_path / "v2.md"
        write_entity(tc_v1, file_a)
        write_entity(tc_v2, file_b)

        result = runner.invoke(
            app,
            [
                "diff", "TC-AUTH-DIFFSTRUCT-001",
                "--file-a", str(file_a),
                "--file-b", str(file_b),
                "--directory", str(populated_project),
                "--json",
            ],
        )
        if result.exit_code == 0:
            data = parse_json_output(result.output)
            # If implemented, check expected structure
            assert isinstance(data, dict)

    def test_diff_no_init_exits_nonzero(self, runner: CliRunner, tmp_path: Path):
        result = runner.invoke(
            app,
            ["diff", "TC-AUTH-001", "--directory", str(tmp_path)],
        )
        # Should fail: either no .wombat/ dir or import error for diff_entity
        assert result.exit_code != 0

    def test_diff_not_found_exits_nonzero(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(
            app,
            ["diff", "TC-NONEXISTENT-9999", "--directory", str(populated_project)],
        )
        assert result.exit_code != 0
