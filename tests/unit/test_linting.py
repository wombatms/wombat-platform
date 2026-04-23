"""Tests for linting/engine.py and all built-in rules."""

from __future__ import annotations

from wombat_core.config.loader import LintConfig, TaxonomyConfig, WombatConfig
from wombat_core.linting.engine import LintEngine, LintIssue, LintRule
from wombat_core.linting.rules import (
    AmbiguousLanguageRule,
    IDFormatRule,
    PlanSuiteRefUnknownRule,
    QualityRule,
    ReferenceIntegrityRule,
    RequiredFieldsRule,
    SuiteCycleRule,
    SuiteSelfParentRule,
    TaxonomyRule,
    default_rules,
)
from wombat_core.models import Plan, SharedStep, Story, Suite, TestCase
from wombat_core.models.plan import Environment
from wombat_core.models.testcase import Step


def _config(**lint_rules) -> WombatConfig:
    return WombatConfig(lint=LintConfig(rules=lint_rules))


def _tc(eid="TC-AUTH-001", title="Login test", component="auth", owner="qa", **kw):
    return TestCase(id=eid, title=title, component=component, owner=owner, **kw)


def _ss(eid="SS-LOGIN-001", title="Login flow", owner="qa", **kw):
    return SharedStep(id=eid, title=title, owner=owner, **kw)


# ---------------------------------------------------------------------------
# LintIssue dataclass
# ---------------------------------------------------------------------------


class TestLintIssue:
    def test_fields(self):
        issue = LintIssue(rule="x", severity="warning", message="msg", entity_id="TC-1")
        assert issue.rule == "x"
        assert issue.field is None


# ---------------------------------------------------------------------------
# LintRule enable/disable
# ---------------------------------------------------------------------------


class TestLintRuleToggle:
    def test_enabled_by_default(self):
        rule = IDFormatRule()
        assert rule.is_enabled(_config())

    def test_disabled_by_false(self):
        rule = IDFormatRule()
        assert not rule.is_enabled(_config(id_format=False))

    def test_disabled_by_dict(self):
        rule = IDFormatRule()
        assert not rule.is_enabled(_config(id_format={"enabled": False}))

    def test_enabled_by_dict(self):
        rule = IDFormatRule()
        assert rule.is_enabled(_config(id_format={"enabled": True}))


# ---------------------------------------------------------------------------
# RequiredFieldsRule
# ---------------------------------------------------------------------------


class TestRequiredFieldsRule:
    rule = RequiredFieldsRule()
    cfg = _config()

    def test_no_issues_on_full_testcase(self):
        tc = _tc(
            summary="A summary",
            steps=[Step(number=1, action="Click login", expected="Page loads")],
        )
        issues = self.rule.check(tc, self.cfg)
        assert all(i.severity != "error" for i in issues)

    def test_warns_missing_summary(self):
        tc = _tc()
        issues = self.rule.check(tc, self.cfg)
        assert any(i.field == "summary" and i.severity == "warning" for i in issues)

    def test_warns_no_steps(self):
        tc = _tc()
        issues = self.rule.check(tc, self.cfg)
        assert any(i.field == "steps" and i.severity == "warning" for i in issues)

    def test_errors_blank_component(self):
        tc = TestCase(id="TC-AUTH-001", title="Test", component="  ", owner="qa")
        issues = self.rule.check(tc, self.cfg)
        assert any(i.field == "component" and i.severity == "error" for i in issues)

    def test_shared_step_warns_no_steps(self):
        ss = _ss()
        issues = self.rule.check(ss, self.cfg)
        assert any(i.field == "steps" and i.severity == "warning" for i in issues)


# ---------------------------------------------------------------------------
# IDFormatRule
# ---------------------------------------------------------------------------


class TestIDFormatRule:
    rule = IDFormatRule()
    cfg = _config()

    def test_correct_prefix(self):
        assert self.rule.check(_tc(), self.cfg) == []

    def test_wrong_prefix_errors(self):
        tc = TestCase(id="SS-AUTH-001", title="Test", component="auth", owner="qa")
        issues = self.rule.check(tc, self.cfg)
        assert any(i.severity == "error" for i in issues)

    def test_plan_correct(self):
        plan = Plan(id="PLAN-RELEASE-2026", title="Release")
        assert self.rule.check(plan, self.cfg) == []

    def test_suite_wrong_prefix(self):
        suite = Suite(id="TC-SMOKE", title="Smoke", owner="qa")
        issues = self.rule.check(suite, self.cfg)
        assert any(i.severity == "error" for i in issues)


# ---------------------------------------------------------------------------
# ReferenceIntegrityRule
# ---------------------------------------------------------------------------


class TestReferenceIntegrityRule:
    rule = ReferenceIntegrityRule()
    cfg = _config()

    def test_single_entity_no_issues(self):
        assert self.rule.check(_tc(), self.cfg) == []

    def test_missing_shared_step(self):
        tc = _tc(shared_steps=["SS-MISSING-001"])
        issues = self.rule.check_corpus([tc], self.cfg)
        assert any(i.field == "shared_steps" for i in issues)

    def test_resolved_shared_step(self):
        ss = _ss(eid="SS-LOGIN-001")
        tc = _tc(shared_steps=["SS-LOGIN-001"])
        issues = self.rule.check_corpus([tc, ss], self.cfg)
        assert issues == []

    def test_missing_suite_case(self):
        suite = Suite(id="SUITE-SMOKE", title="Smoke", owner="qa", cases=["TC-MISSING-001"])
        issues = self.rule.check_corpus([suite], self.cfg)
        assert any(i.field == "cases" for i in issues)

    def test_missing_story_linked_test(self):
        story = Story(
            id="STORY-A",
            title="A",
            owner="pm",
            linked_tests=["TC-MISSING-001"],
        )
        issues = self.rule.check_corpus([story], self.cfg)
        assert any(i.field == "linked_tests" for i in issues)


# ---------------------------------------------------------------------------
# AmbiguousLanguageRule
# ---------------------------------------------------------------------------


class TestAmbiguousLanguageRule:
    rule = AmbiguousLanguageRule()
    cfg = _config()

    def test_clean_steps(self):
        tc = _tc(steps=[Step(number=1, action="Click the Login button", expected="Dashboard appears")])
        assert self.rule.check(tc, self.cfg) == []

    def test_vague_action(self):
        tc = _tc(
            steps=[
                Step(
                    number=1,
                    action="Sometimes click the login button",
                    expected="Dashboard appears",
                )
            ]
        )
        issues = self.rule.check(tc, self.cfg)
        assert any("sometimes" in i.message.lower() for i in issues)

    def test_vague_expected(self):
        tc = _tc(
            steps=[
                Step(
                    number=1,
                    action="Click login",
                    expected="Usually the dashboard appears",
                )
            ]
        )
        issues = self.rule.check(tc, self.cfg)
        assert any("usually" in i.message.lower() for i in issues)

    def test_vague_title(self):
        tc = _tc(title="This should work sometimes")
        issues = self.rule.check(tc, self.cfg)
        assert any(i.field in ("title", "summary") for i in issues)

    def test_shared_step_vague(self):
        ss = _ss(steps=[Step(number=1, action="Maybe click login", expected="Form appears")])
        issues = self.rule.check(ss, self.cfg)
        assert len(issues) > 0


# ---------------------------------------------------------------------------
# TaxonomyRule
# ---------------------------------------------------------------------------


class TestTaxonomyRule:
    rule = TaxonomyRule()

    def _cfg_with_components(self, *components):
        return WombatConfig(taxonomy=TaxonomyConfig(components=list(components)))

    def test_no_taxonomy_configured(self):
        tc = _tc(component="payments")
        assert self.rule.check(tc, _config()) == []

    def test_component_in_taxonomy(self):
        tc = _tc(component="auth")
        cfg = self._cfg_with_components("auth", "payments")
        assert self.rule.check(tc, cfg) == []

    def test_component_not_in_taxonomy(self):
        tc = _tc(component="billing")
        cfg = self._cfg_with_components("auth", "payments")
        issues = self.rule.check(tc, cfg)
        assert any(i.field == "component" for i in issues)

    def test_plan_environment_not_in_taxonomy(self):
        plan = Plan(
            id="PLAN-RELEASE-2026",
            title="Release",
            environments=[Environment(name="unknown-env")],
        )
        cfg = WombatConfig(taxonomy=TaxonomyConfig(environments=["staging", "production"]))
        issues = self.rule.check(plan, cfg)
        assert any(i.field == "environments" for i in issues)

    def test_plan_environment_in_taxonomy(self):
        plan = Plan(
            id="PLAN-RELEASE-2026",
            title="Release",
            environments=[Environment(name="staging")],
        )
        cfg = WombatConfig(taxonomy=TaxonomyConfig(environments=["staging", "production"]))
        assert self.rule.check(plan, cfg) == []


# ---------------------------------------------------------------------------
# QualityRule
# ---------------------------------------------------------------------------


class TestQualityRule:
    rule = QualityRule()
    cfg = _config()

    def test_good_testcase(self):
        tc = _tc(
            title="A descriptive title for login",
            steps=[
                Step(number=1, action="Enter valid credentials", expected="Login succeeds"),
                Step(number=2, action="Verify dashboard loads", expected="Dashboard visible"),
            ],
        )
        assert self.rule.check(tc, self.cfg) == []

    def test_short_title(self):
        tc = _tc(title="Login")
        issues = self.rule.check(tc, self.cfg)
        assert any(i.field == "title" for i in issues)

    def test_short_step_action(self):
        tc = _tc(steps=[Step(number=1, action="Go", expected="Something happens here")])
        issues = self.rule.check(tc, self.cfg)
        assert any("action" in (i.field or "") for i in issues)

    def test_one_step_warning(self):
        tc = _tc(
            title="A descriptive title for login",
            steps=[Step(number=1, action="Click login button", expected="Dashboard loads")],
        )
        issues = self.rule.check(tc, self.cfg)
        assert any(i.field == "steps" for i in issues)

    def test_configurable_min_title(self):
        tc = _tc(title="Short")
        cfg = WombatConfig(lint=LintConfig(rules={"quality": {"min_title_len": 3}}))
        issues = self.rule.check(tc, cfg)
        assert not any(i.field == "title" for i in issues)


# ---------------------------------------------------------------------------
# LintEngine
# ---------------------------------------------------------------------------


class TestLintEngine:
    def test_lint_entity_returns_issues(self):
        engine = LintEngine(_config())
        tc = _tc()  # no steps, no summary — will trigger warnings
        issues = engine.lint_entity(tc)
        assert isinstance(issues, list)

    def test_lint_corpus_cross_entity(self):
        engine = LintEngine(_config())
        tc = _tc(shared_steps=["SS-MISSING-001"])
        issues = engine.lint_corpus([tc])
        assert any(i.rule == "reference_integrity" for i in issues)

    def test_disabled_rule_skipped(self):
        engine = LintEngine(_config(id_format=False))
        tc = TestCase(id="SS-WRONG-TYPE", title="Test", component="auth", owner="qa")
        issues = engine.lint_entity(tc)
        assert not any(i.rule == "id_format" for i in issues)

    def test_custom_rules_replace_defaults(self):
        class NoOpRule(LintRule):
            name = "noop"

            def check(self, entity, config):
                return []

        engine = LintEngine(_config(), rules=[NoOpRule()])
        tc = _tc()
        issues = engine.lint_entity(tc)
        assert issues == []

    def test_default_rules_count(self):
        rules = default_rules()
        assert len(rules) == 9  # noqa: PLR2004


# ---------------------------------------------------------------------------
# SP3.4: Suite hierarchy + plan/suite cross-reference rules
# ---------------------------------------------------------------------------


def _suite(eid="SUITE-A", title="Suite A", owner="qa", **kw):
    return Suite(id=eid, title=title, owner=owner, **kw)


def _plan(eid="PLAN-X", title="Plan X", **kw):
    return Plan(id=eid, title=title, **kw)


class TestSuiteSelfParentRule:
    rule = SuiteSelfParentRule()
    cfg = _config()

    def test_self_parent_is_error(self):
        s = _suite(eid="SUITE-A", parent_wombat_id="SUITE-A")
        issues = self.rule.check(s, self.cfg)
        assert any(i.severity == "error" for i in issues)
        assert any(i.field == "parent_wombat_id" for i in issues)

    def test_no_parent_ok(self):
        s = _suite(eid="SUITE-A")
        assert self.rule.check(s, self.cfg) == []

    def test_different_parent_ok(self):
        s = _suite(eid="SUITE-A", parent_wombat_id="SUITE-B")
        assert self.rule.check(s, self.cfg) == []


class TestSuiteCycleRule:
    rule = SuiteCycleRule()
    cfg = _config()

    def test_two_suite_cycle(self):
        a = _suite(eid="SUITE-A", parent_wombat_id="SUITE-B")
        b = _suite(eid="SUITE-B", parent_wombat_id="SUITE-A")
        issues = self.rule.check_corpus([a, b], self.cfg)
        assert any(i.severity == "error" for i in issues)
        cycle_entities = {i.entity_id for i in issues}
        assert cycle_entities == {"SUITE-A", "SUITE-B"}

    def test_three_suite_cycle(self):
        a = _suite(eid="SUITE-A", parent_wombat_id="SUITE-B")
        b = _suite(eid="SUITE-B", parent_wombat_id="SUITE-C")
        c = _suite(eid="SUITE-C", parent_wombat_id="SUITE-A")
        issues = self.rule.check_corpus([a, b, c], self.cfg)
        assert len(issues) >= 1
        assert all(i.severity == "error" for i in issues)

    def test_linear_tree_ok(self):
        a = _suite(eid="SUITE-A")
        b = _suite(eid="SUITE-B", parent_wombat_id="SUITE-A")
        c = _suite(eid="SUITE-C", parent_wombat_id="SUITE-B")
        assert self.rule.check_corpus([a, b, c], self.cfg) == []

    def test_missing_parent_is_not_cycle(self):
        # A parent pointing at a suite that does not exist is not a cycle;
        # the "unknown ref" issue is handled elsewhere.
        a = _suite(eid="SUITE-A", parent_wombat_id="SUITE-MISSING")
        assert self.rule.check_corpus([a], self.cfg) == []


class TestPlanSuiteRefUnknownRule:
    rule = PlanSuiteRefUnknownRule()
    cfg = _config()

    def test_unknown_ref_is_warning(self):
        p = _plan(eid="PLAN-X", suite_refs=["SUITE-MISSING"])
        issues = self.rule.check_corpus([p], self.cfg)
        bad = [i for i in issues if i.rule == "plan_suite_ref_unknown"]
        assert bad and bad[0].severity == "warning"
        assert bad[0].entity_id == "PLAN-X"
        assert bad[0].field == "suite_refs"

    def test_known_ref_ok(self):
        s = _suite(eid="SUITE-A")
        p = _plan(eid="PLAN-X", suite_refs=["SUITE-A"])
        assert self.rule.check_corpus([s, p], self.cfg) == []

    def test_empty_suite_refs_ok(self):
        p = _plan(eid="PLAN-X")
        assert self.rule.check_corpus([p], self.cfg) == []


class TestEngineIntegrationSP34:
    def test_engine_emits_cycle_code_via_corpus(self):
        engine = LintEngine(_config())
        a = _suite(eid="SUITE-A", parent_wombat_id="SUITE-B")
        b = _suite(eid="SUITE-B", parent_wombat_id="SUITE-A")
        issues = engine.lint_corpus([a, b])
        assert any(i.rule == "suite_cycle" for i in issues)

    def test_engine_emits_self_parent_code(self):
        engine = LintEngine(_config())
        s = _suite(eid="SUITE-A", parent_wombat_id="SUITE-A")
        issues = engine.lint_corpus([s])
        assert any(i.rule == "suite_self_parent" for i in issues)

    def test_engine_emits_plan_suite_ref_unknown(self):
        engine = LintEngine(_config())
        p = _plan(eid="PLAN-X", suite_refs=["SUITE-MISSING"])
        issues = engine.lint_corpus([p])
        assert any(i.rule == "plan_suite_ref_unknown" for i in issues)
