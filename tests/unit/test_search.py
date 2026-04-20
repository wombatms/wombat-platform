"""Tests for search/local.py."""

from __future__ import annotations

from pathlib import Path

import pytest

from wombat_core.models import Plan, SharedStep, Story, Suite, TestCase
from wombat_core.models.testcase import Step
from wombat_core.parsing.writer import write_entity
from wombat_core.search.local import SearchResult, search_files


def _write_tc(directory: Path, tc: TestCase) -> None:
    write_entity(tc, directory / f"{tc.id}.md")


def _write_plan(directory: Path, plan: Plan) -> None:
    write_entity(plan, directory / f"{plan.id}.yaml")


def _write_suite(directory: Path, suite: Suite) -> None:
    write_entity(suite, directory / f"{suite.id}.yaml")


def _write_ss(directory: Path, ss: SharedStep) -> None:
    write_entity(ss, directory / f"{ss.id}.md")


def _write_story(directory: Path, story: Story) -> None:
    write_entity(story, directory / f"{story.id}.md")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def corpus_dir(tmp_path):
    """Build a small mixed corpus in tmp_path."""
    _write_tc(
        tmp_path,
        TestCase(
            id="TC-PAYMENTS-REFUND-0001",
            title="Refund via card",
            component="payments",
            owner="qa-payments",
            priority="high",
            status="active",
            tags=["payments", "regression"],
            steps=[Step(number=1, action="Click refund", expected="Dialog shown")],
        ),
    )
    _write_tc(
        tmp_path,
        TestCase(
            id="TC-AUTH-LOGIN-0001",
            title="Basic login",
            component="auth",
            owner="qa-auth",
            priority="medium",
            status="draft",
            tags=["auth", "smoke"],
        ),
    )
    _write_tc(
        tmp_path,
        TestCase(
            id="TC-AUTH-LOGOUT-0001",
            title="Basic logout",
            component="auth",
            owner="qa-auth",
            priority="low",
            status="active",
            tags=["auth"],
        ),
    )
    _write_plan(tmp_path, Plan(id="PLAN-RELEASE-2026", title="Release 2026"))
    _write_suite(
        tmp_path,
        Suite(id="SUITE-SMOKE", title="Smoke suite", owner="qa-team", tags=["smoke"]),
    )
    _write_ss(tmp_path, SharedStep(id="SS-LOGIN-001", title="Login steps", owner="qa-auth"))
    _write_story(
        tmp_path,
        Story(id="STORY-AUTH", title="Auth story", owner="pm-team"),
    )
    return tmp_path


# ---------------------------------------------------------------------------
# Basic searches
# ---------------------------------------------------------------------------


class TestSearchFiles:
    def test_returns_search_result(self, corpus_dir):
        result = search_files(corpus_dir)
        assert isinstance(result, SearchResult)

    def test_finds_all_entities(self, corpus_dir):
        result = search_files(corpus_dir)
        # 3 TCs + 1 Plan + 1 Suite + 1 SS + 1 Story = 7
        assert result.total == 7

    def test_default_limit(self, corpus_dir):
        result = search_files(corpus_dir)
        assert result.limit == 50

    def test_filter_by_entity_type_testcase(self, corpus_dir):
        result = search_files(corpus_dir, entity_type="testcase")
        assert result.total == 3
        assert all(isinstance(e, TestCase) for e in result.entities)

    def test_filter_by_entity_type_plan(self, corpus_dir):
        result = search_files(corpus_dir, entity_type="plan")
        assert result.total == 1
        assert isinstance(result.entities[0], Plan)

    def test_filter_by_component(self, corpus_dir):
        result = search_files(corpus_dir, component="auth")
        assert result.total == 2
        assert all(e.component == "auth" for e in result.entities)

    def test_filter_by_owner(self, corpus_dir):
        result = search_files(corpus_dir, owner="qa-auth")
        assert result.total == 3  # 2 TCs + 1 SS

    def test_filter_by_priority(self, corpus_dir):
        result = search_files(corpus_dir, entity_type="testcase", priority="high")
        assert result.total == 1
        assert result.entities[0].id == "TC-PAYMENTS-REFUND-0001"

    def test_filter_by_status(self, corpus_dir):
        result = search_files(corpus_dir, entity_type="testcase", status="active")
        assert result.total == 2

    def test_filter_by_single_tag(self, corpus_dir):
        result = search_files(corpus_dir, tags=["regression"])
        assert result.total == 1

    def test_filter_by_multiple_tags_and_logic(self, corpus_dir):
        result = search_files(corpus_dir, tags=["auth", "smoke"])
        assert result.total == 1  # only TC-AUTH-LOGIN has both tags

    def test_filter_by_type(self, corpus_dir):
        result = search_files(corpus_dir, entity_type="testcase", type="functional")
        # Default type for TestCase is functional
        assert result.total == 3

    def test_combined_filters(self, corpus_dir):
        result = search_files(corpus_dir, component="auth", status="active")
        assert result.total == 1
        assert result.entities[0].id == "TC-AUTH-LOGOUT-0001"

    def test_no_match_returns_empty(self, corpus_dir):
        result = search_files(corpus_dir, component="nonexistent")
        assert result.total == 0
        assert result.entities == []


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------


class TestSearchPagination:
    def test_limit(self, corpus_dir):
        result = search_files(corpus_dir, limit=2)
        assert len(result.entities) == 2
        assert result.total == 7

    def test_offset(self, corpus_dir):
        result_all = search_files(corpus_dir)
        result_page = search_files(corpus_dir, offset=3, limit=10)
        assert len(result_page.entities) == result_all.total - 3

    def test_has_more_true(self, corpus_dir):
        result = search_files(corpus_dir, limit=2, offset=0)
        assert result.has_more

    def test_has_more_false(self, corpus_dir):
        result = search_files(corpus_dir, limit=50, offset=0)
        assert not result.has_more

    def test_offset_beyond_total_returns_empty(self, corpus_dir):
        result = search_files(corpus_dir, offset=100)
        assert result.entities == []
        assert result.total == 7

    def test_empty_directory(self, tmp_path):
        result = search_files(tmp_path)
        assert result.total == 0
        assert result.entities == []
