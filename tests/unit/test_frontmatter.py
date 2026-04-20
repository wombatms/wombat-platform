"""Tests for parsing/frontmatter.py."""

from __future__ import annotations

import textwrap
from pathlib import Path

from wombat_core.models import SharedStep, Story, TestCase
from wombat_core.parsing.frontmatter import (
    ParseResult,
    ParseWarning,
    detect_entity_type,
    parse_markdown_file,
)

# ---------------------------------------------------------------------------
# detect_entity_type
# ---------------------------------------------------------------------------


class TestDetectEntityType:
    def test_tc_prefix(self):
        assert detect_entity_type("TC-AUTH-001") is TestCase

    def test_ss_prefix(self):
        from wombat_core.models import SharedStep

        assert detect_entity_type("SS-LOGIN-001") is SharedStep

    def test_plan_prefix(self):
        from wombat_core.models import Plan

        assert detect_entity_type("PLAN-RELEASE-2026") is Plan

    def test_story_prefix(self):
        from wombat_core.models import Story

        assert detect_entity_type("STORY-CHECKOUT") is Story

    def test_suite_prefix(self):
        from wombat_core.models import Suite

        assert detect_entity_type("SUITE-SMOKE") is Suite

    def test_unknown_prefix(self):
        assert detect_entity_type("FOO-BAR") is None


# ---------------------------------------------------------------------------
# parse_markdown_file helpers
# ---------------------------------------------------------------------------


def _write_md(tmp_path: Path, content: str) -> Path:
    p = tmp_path / "entity.md"
    p.write_text(textwrap.dedent(content), encoding="utf-8")
    return p


class TestParseMarkdownFile:
    def test_minimal_testcase(self, tmp_path):
        p = _write_md(
            tmp_path,
            """\
            ---
            id: TC-AUTH-LOGIN-0001
            title: Basic login test
            component: auth
            owner: qa-team
            ---
            """,
        )
        result = parse_markdown_file(p)
        assert result.ok
        assert isinstance(result.entity, TestCase)
        assert result.entity.id == "TC-AUTH-LOGIN-0001"
        assert result.entity.component == "auth"
        assert result.entity.body is None

    def test_testcase_with_body(self, tmp_path):
        p = _write_md(
            tmp_path,
            """\
            ---
            id: TC-AUTH-LOGIN-0001
            title: Basic login test
            component: auth
            owner: qa-team
            ---
            # Details
            Some extra notes.
            """,
        )
        result = parse_markdown_file(p)
        assert result.ok
        assert "# Details" in result.entity.body

    def test_shared_step(self, tmp_path):
        p = _write_md(
            tmp_path,
            """\
            ---
            id: SS-LOGIN-001
            title: Login flow
            owner: qa-team
            steps:
              - number: 1
                action: Enter username
                expected: Field populated
            ---
            """,
        )
        result = parse_markdown_file(p)
        assert result.ok
        assert isinstance(result.entity, SharedStep)
        assert len(result.entity.steps) == 1

    def test_story(self, tmp_path):
        p = _write_md(
            tmp_path,
            """\
            ---
            id: STORY-CHECKOUT-REFUNDS
            title: Refund capability
            owner: product-team
            ---
            As a customer I want refunds.
            """,
        )
        result = parse_markdown_file(p)
        assert result.ok
        assert isinstance(result.entity, Story)
        assert "refunds" in result.entity.body

    def test_missing_id_returns_error(self, tmp_path):
        p = _write_md(
            tmp_path,
            """\
            ---
            title: No ID here
            component: auth
            owner: qa
            ---
            """,
        )
        result = parse_markdown_file(p)
        assert not result.ok
        assert result.error is not None
        assert "id" in result.error.lower()

    def test_unknown_id_prefix_returns_error(self, tmp_path):
        p = _write_md(
            tmp_path,
            """\
            ---
            id: UNKNOWN-FOO-001
            title: Something
            component: auth
            owner: qa
            ---
            """,
        )
        result = parse_markdown_file(p)
        assert not result.ok
        assert "unknown" in result.error.lower()

    def test_missing_required_field_returns_error_with_warnings(self, tmp_path):
        p = _write_md(
            tmp_path,
            """\
            ---
            id: TC-AUTH-001
            title: Test
            ---
            """,
        )
        result = parse_markdown_file(p)
        assert not result.ok
        assert result.error is not None
        assert len(result.warnings) > 0

    def test_nonexistent_file(self, tmp_path):
        p = tmp_path / "ghost.md"
        result = parse_markdown_file(p)
        assert not result.ok
        assert result.error is not None

    def test_parse_result_source_path(self, tmp_path):
        p = _write_md(
            tmp_path,
            """\
            ---
            id: TC-AUTH-LOGIN-0001
            title: Basic login test
            component: auth
            owner: qa-team
            ---
            """,
        )
        result = parse_markdown_file(p)
        assert result.source_path == p

    def test_parse_warning_dataclass(self):
        w = ParseWarning(field="title", message="missing")
        assert w.field == "title"
        assert w.message == "missing"

    def test_parse_result_dataclass(self):
        r = ParseResult(entity=None, error="oops")
        assert not r.ok
        assert r.warnings == []
