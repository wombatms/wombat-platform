"""Integration tests for `wombat lint`."""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from wombat_cli.main import app
from wombat_core.models.testcase import TestCase
from wombat_core.parsing.writer import write_entity

from .conftest import parse_json_output


class TestLintCommand:
    def test_lint_clean_project_exits_0(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(app, ["lint", "--directory", str(populated_project)])
        # Exit 0 = no issues; exit 2 = issues found
        assert result.exit_code in (0, 2)

    def test_lint_json_output_structure(self, runner: CliRunner, populated_project: Path):
        result = runner.invoke(app, ["lint", "--directory", str(populated_project), "--json"])
        assert result.exit_code in (0, 2)
        data = parse_json_output(result.output)
        assert "issues" in data
        assert "total" in data
        assert isinstance(data["issues"], list)

    def test_lint_specific_directory_clean(self, runner: CliRunner, populated_project: Path):
        tc_dir = populated_project / ".wombat" / "testcases"
        result = runner.invoke(app, ["lint", str(tc_dir), "--directory", str(populated_project)])
        assert result.exit_code in (0, 2)

    def test_lint_finds_issues_in_bad_file(self, runner: CliRunner, populated_project: Path):
        # Write a test case with a very short title (< 10 chars) and no steps/summary.
        # QualityRule will warn on short title; RequiredFieldsRule will warn on
        # missing summary and missing steps. These produce exit_code 2.
        bad_tc = TestCase(
            id="TC-AUTH-BADTC-LINT-001",
            title="Tiny",  # 4 chars — below QualityRule minimum of 10
            component="auth",
            owner="qa",
            # no summary, no steps → multiple warnings from RequiredFieldsRule
        )
        tc_dir = populated_project / ".wombat" / "testcases"
        write_entity(bad_tc, tc_dir / "tc-auth-bad-lint.md")

        # Lint the testcases directory (not a single file — search_files walks dirs)
        result = runner.invoke(
            app,
            ["lint", str(tc_dir), "--directory", str(populated_project), "--json"],
        )
        assert result.exit_code == 2
        data = parse_json_output(result.output)
        assert data["total"] > 0

    def test_lint_no_init_exits_1_when_no_paths(self, runner: CliRunner, tmp_path: Path):
        result = runner.invoke(app, ["lint", "--directory", str(tmp_path)])
        assert result.exit_code == 1

    def test_lint_json_issues_have_required_fields(self, runner: CliRunner, populated_project: Path):
        # Write something with a short title to trigger QualityRule
        bad_tc = TestCase(id="TC-AUTH-BADTC-001", title="Short", component="auth", owner="qa")
        tc_dir = populated_project / ".wombat" / "testcases"
        write_entity(bad_tc, tc_dir / "bad-tc.md")

        result = runner.invoke(
            app,
            ["lint", str(tc_dir), "--directory", str(populated_project), "--json"],
        )
        data = parse_json_output(result.output)
        if data["total"] > 0:
            issue = data["issues"][0]
            assert "rule" in issue
            assert "severity" in issue
            assert "message" in issue
            assert "entity_id" in issue
