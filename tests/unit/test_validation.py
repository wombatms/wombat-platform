"""Tests for validation/schema.py."""

from __future__ import annotations

from wombat_core.models import Plan, SharedStep, Story, Suite, TestCase
from wombat_core.validation.schema import (
    ValidationResult,
    validate_corpus,
    validate_entity,
)


def _tc(eid="TC-AUTH-001", title="Login test", component="auth", owner="qa", **kw):
    return TestCase(id=eid, title=title, component=component, owner=owner, **kw)


def _ss(eid="SS-LOGIN-001", title="Login flow", owner="qa", **kw):
    return SharedStep(id=eid, title=title, owner=owner, **kw)


def _plan(eid="PLAN-RELEASE-2026", title="Release", **kw):
    return Plan(id=eid, title=title, **kw)


def _story(eid="STORY-CHECKOUT", title="Checkout", owner="product", **kw):
    return Story(id=eid, title=title, owner=owner, **kw)


def _suite(eid="SUITE-SMOKE", title="Smoke", owner="qa", **kw):
    return Suite(id=eid, title=title, owner=owner, **kw)


# ---------------------------------------------------------------------------
# validate_entity
# ---------------------------------------------------------------------------


class TestValidateEntity:
    def test_valid_testcase(self):
        result = validate_entity(_tc())
        assert result.valid
        assert result.errors == []

    def test_valid_plan(self):
        result = validate_entity(_plan())
        assert result.valid

    def test_valid_suite(self):
        result = validate_entity(_suite())
        assert result.valid

    def test_valid_story(self):
        result = validate_entity(_story())
        assert result.valid

    def test_valid_shared_step(self):
        result = validate_entity(_ss())
        assert result.valid

    def test_wrong_prefix_testcase(self):
        tc = TestCase(id="SS-AUTH-001", title="Test", component="auth", owner="qa")
        result = validate_entity(tc)
        assert not result.valid
        assert any("prefix" in e.message.lower() for e in result.errors)

    def test_wrong_prefix_plan(self):
        plan = Plan(id="TC-RELEASE-2026", title="Release")
        result = validate_entity(plan)
        assert not result.valid

    def test_empty_title_triggers_error(self):
        tc = TestCase(id="TC-AUTH-001", title="   ", component="auth", owner="qa")
        result = validate_entity(tc)
        assert not result.valid
        assert any(e.field == "title" for e in result.errors)

    def test_empty_component_triggers_error(self):
        tc = TestCase(id="TC-AUTH-001", title="Test", component="   ", owner="qa")
        result = validate_entity(tc)
        assert not result.valid
        assert any(e.field == "component" for e in result.errors)

    def test_result_dataclass_structure(self):
        result = validate_entity(_tc())
        assert isinstance(result, ValidationResult)
        assert isinstance(result.errors, list)
        assert isinstance(result.warnings, list)


# ---------------------------------------------------------------------------
# validate_corpus
# ---------------------------------------------------------------------------


class TestValidateCorpus:
    def test_clean_corpus(self):
        entities = [_tc(), _ss(), _plan(), _story(), _suite()]
        result = validate_corpus(entities)
        assert result.valid

    def test_duplicate_ids(self):
        entities = [_tc(eid="TC-AUTH-001"), _tc(eid="TC-AUTH-001", title="Dup")]
        result = validate_corpus(entities)
        assert not result.valid
        assert any("duplicate" in e.message.lower() for e in result.errors)

    def test_broken_shared_step_reference(self):
        tc = _tc(shared_steps=["SS-MISSING-001"])
        result = validate_corpus([tc])
        assert not result.valid
        assert any("shared step" in e.message.lower() for e in result.errors)

    def test_shared_step_reference_resolved(self):
        ss = _ss(eid="SS-LOGIN-001")
        tc = _tc(shared_steps=["SS-LOGIN-001"])
        result = validate_corpus([tc, ss])
        assert result.valid

    def test_broken_suite_case_reference(self):
        suite = _suite(cases=["TC-MISSING-001"])
        result = validate_corpus([suite])
        assert not result.valid
        assert any(e.field == "cases" for e in result.errors)

    def test_broken_story_linked_test(self):
        story = _story(linked_tests=["TC-MISSING-001"])
        result = validate_corpus([story])
        assert not result.valid
        assert any(e.field == "linked_tests" for e in result.errors)

    def test_superseded_by_resolved(self):
        old_tc = _tc(eid="TC-AUTH-001", superseded_by="TC-AUTH-002")
        new_tc = _tc(eid="TC-AUTH-002")
        result = validate_corpus([old_tc, new_tc])
        assert result.valid

    def test_broken_superseded_by(self):
        tc = _tc(superseded_by="TC-MISSING-999")
        result = validate_corpus([tc])
        assert not result.valid

    def test_empty_corpus(self):
        result = validate_corpus([])
        assert result.valid

    def test_error_entity_id_populated(self):
        tc = TestCase(id="SS-WRONG-001", title="Test", component="auth", owner="qa")
        result = validate_corpus([tc])
        assert any(e.entity_id == "SS-WRONG-001" for e in result.errors)
