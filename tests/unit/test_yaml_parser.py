"""Tests for parsing/yaml_parser.py and parsing/writer.py."""

from __future__ import annotations

import textwrap
from pathlib import Path

from wombat_core.models import Plan, Suite, TestCase
from wombat_core.models.testcase import Step
from wombat_core.parsing.frontmatter import parse_markdown_file
from wombat_core.parsing.writer import serialise_entity, write_entity
from wombat_core.parsing.yaml_parser import parse_yaml_file


def _write_yaml(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(textwrap.dedent(content), encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# YAML parser
# ---------------------------------------------------------------------------


class TestParseYamlFile:
    def test_minimal_plan(self, tmp_path):
        p = _write_yaml(
            tmp_path,
            "plan.yaml",
            """\
            id: PLAN-RELEASE-2026
            title: Release validation
            """,
        )
        result = parse_yaml_file(p)
        assert result.ok
        assert isinstance(result.entity, Plan)
        assert result.entity.id == "PLAN-RELEASE-2026"

    def test_minimal_suite(self, tmp_path):
        p = _write_yaml(
            tmp_path,
            "suite.yaml",
            """\
            id: SUITE-PAYMENTS-REGRESSION
            title: Payments regression
            owner: qa-team
            """,
        )
        result = parse_yaml_file(p)
        assert result.ok
        assert isinstance(result.entity, Suite)

    def test_plan_with_include(self, tmp_path):
        p = _write_yaml(
            tmp_path,
            "plan.yaml",
            """\
            id: PLAN-RELEASE-2026
            title: Release validation
            include:
              tags_any:
                - payments
                - critical-path
              components_any:
                - payments
            """,
        )
        result = parse_yaml_file(p)
        assert result.ok
        assert "payments" in result.entity.include.tags_any

    def test_missing_id_returns_error(self, tmp_path):
        p = _write_yaml(tmp_path, "bad.yaml", "title: No ID\n")
        result = parse_yaml_file(p)
        assert not result.ok
        assert "id" in result.error.lower()

    def test_non_markdown_entity_returns_error(self, tmp_path):
        # TestCase entities should not be in .yaml files
        p = _write_yaml(
            tmp_path,
            "tc.yaml",
            """\
            id: TC-AUTH-001
            title: Test
            component: auth
            owner: qa
            """,
        )
        result = parse_yaml_file(p)
        assert not result.ok

    def test_non_mapping_returns_error(self, tmp_path):
        p = _write_yaml(tmp_path, "bad.yaml", "- item1\n- item2\n")
        result = parse_yaml_file(p)
        assert not result.ok

    def test_parse_source_path(self, tmp_path):
        p = _write_yaml(tmp_path, "plan.yaml", "id: PLAN-X\ntitle: X\n")
        result = parse_yaml_file(p)
        assert result.source_path == p


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------


class TestSerialiseEntity:
    def test_testcase_is_markdown(self):
        tc = TestCase(id="TC-AUTH-001", title="Login test", component="auth", owner="qa")
        out = serialise_entity(tc)
        assert out.startswith("---\n")
        assert "id: TC-AUTH-001" in out
        assert "title: Login test" in out

    def test_plan_is_yaml(self):
        plan = Plan(id="PLAN-RELEASE-2026", title="Release validation")
        out = serialise_entity(plan)
        assert not out.startswith("---\n")
        assert "id: PLAN-RELEASE-2026" in out

    def test_suite_is_yaml(self):
        suite = Suite(id="SUITE-PAYMENTS-REGRESSION", title="Payments regression", owner="qa-team")
        out = serialise_entity(suite)
        assert not out.startswith("---\n")

    def test_body_is_written_after_frontmatter(self):
        tc = TestCase(
            id="TC-AUTH-001",
            title="Login test",
            component="auth",
            owner="qa",
            body="# Notes\nSome details.",
        )
        out = serialise_entity(tc)
        parts = out.split("---\n")
        # parts[0] = empty before first ---
        # parts[1] = frontmatter YAML
        # parts[2] = body
        assert len(parts) >= 3
        assert "# Notes" in parts[2]

    def test_none_fields_omitted(self):
        tc = TestCase(id="TC-AUTH-001", title="Login test", component="auth", owner="qa")
        out = serialise_entity(tc)
        assert "summary: null" not in out
        assert "superseded_by: null" not in out

    def test_empty_lists_omitted(self):
        tc = TestCase(id="TC-AUTH-001", title="Login test", component="auth", owner="qa")
        out = serialise_entity(tc)
        assert "tags: []" not in out
        assert "steps: []" not in out

    def test_field_ordering_testcase(self):
        tc = TestCase(
            id="TC-AUTH-001",
            title="Login test",
            component="auth",
            owner="qa",
            summary="Test summary",
        )
        out = serialise_entity(tc)
        id_pos = out.index("id:")
        title_pos = out.index("title:")
        summary_pos = out.index("summary:")
        component_pos = out.index("component:")
        assert id_pos < title_pos < summary_pos < component_pos

    def test_steps_serialise_correctly(self):
        tc = TestCase(
            id="TC-AUTH-001",
            title="Login test",
            component="auth",
            owner="qa",
            steps=[Step(number=1, action="Click login", expected="Page loads")],
        )
        out = serialise_entity(tc)
        assert "Click login" in out
        assert "Page loads" in out


class TestWriteEntity:
    def test_writes_file(self, tmp_path):
        tc = TestCase(id="TC-AUTH-001", title="Login test", component="auth", owner="qa")
        p = tmp_path / "tc.md"
        write_entity(tc, p)
        assert p.exists()
        assert "TC-AUTH-001" in p.read_text()


# ---------------------------------------------------------------------------
# Round-trip
# ---------------------------------------------------------------------------


class TestRoundTrip:
    def test_testcase_round_trip(self, tmp_path):
        tc = TestCase(
            id="TC-PAYMENTS-REFUND-0012",
            title="Refund succeeds for captured payment",
            summary="Verify refund flow",
            component="payments",
            owner="qa-platform",
            tags=["payments", "regression"],
            steps=[Step(number=1, action="Open order details", expected="Page loads")],
        )
        p = tmp_path / "tc.md"
        write_entity(tc, p)
        result = parse_markdown_file(p)
        assert result.ok
        assert result.entity == tc

    def test_plan_round_trip(self, tmp_path):
        plan = Plan(
            id="PLAN-RELEASE-2026",
            title="Release validation",
            description="Full release validation plan",
            assignees=["qa-lead"],
        )
        p = tmp_path / "plan.yaml"
        write_entity(plan, p)
        result = parse_yaml_file(p)
        assert result.ok
        assert result.entity == plan

    def test_suite_round_trip(self, tmp_path):
        suite = Suite(
            id="SUITE-PAYMENTS-REGRESSION",
            title="Payments regression",
            owner="qa-team",
            tags=["regression"],
        )
        p = tmp_path / "suite.yaml"
        write_entity(suite, p)
        result = parse_yaml_file(p)
        assert result.ok
        assert result.entity == suite
