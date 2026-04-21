"""Tests for proposals.frontmatter.mutate_review_block."""

from datetime import UTC, datetime

from wombat_api.proposals.frontmatter import mutate_review_block


def test_adds_review_block_when_missing():
    body = {"frontmatter": {}, "markdown": "hi"}
    out = mutate_review_block(
        body,
        approver_display_name="Alice",
        approver_email="a@x",
        action="approve",
        now=datetime(2026, 4, 21, tzinfo=UTC),
    )
    assert out["frontmatter"]["review"]["state"] == "approved"
    assert "Alice <a@x>" in out["frontmatter"]["review"]["approved_by"]


def test_appends_without_duplicating_approver():
    body = {
        "frontmatter": {"review": {"state": "pending", "approved_by": ["Alice <a@x>"]}},
        "markdown": "",
    }
    out = mutate_review_block(body, approver_display_name="Alice", approver_email="a@x", action="approve")
    assert out["frontmatter"]["review"]["approved_by"] == ["Alice <a@x>"]


def test_direct_publish_sets_flag():
    body = {"frontmatter": {}, "markdown": ""}
    out = mutate_review_block(body, approver_display_name="B", approver_email="b@x", action="direct_publish")
    assert out["frontmatter"]["review"]["published_directly"] is True


def test_does_not_mutate_input():
    body = {"frontmatter": {"review": {"state": "pending"}}, "markdown": ""}
    mutate_review_block(body, approver_display_name="A", approver_email="a@x", action="approve")
    assert body["frontmatter"]["review"]["state"] == "pending"
