"""Tests for domain model validation."""

from typing import Annotated

import pytest
from pydantic import BaseModel, Field, ValidationError

from wombat_core.models.common import (
    AutomationStatus,
    CoverageState,
    ExecutionMode,
    Priority,
    ReviewState,
    RiskLevel,
    TestCaseStatus,
    TestType,
)
from wombat_core.models.plan import Environment, IncludeExclude, Plan, ScopeSelector
from wombat_core.models.shared_step import SharedStep
from wombat_core.models.story import Story
from wombat_core.models.suite import Suite
from wombat_core.models.testcase import AutomationInfo, ReviewInfo, Step, TestCase


# Test WombatID via a wrapper model since it's an Annotated type
class IDHolder(BaseModel):
    id: Annotated[str, Field(pattern=r"^(TC|SS|PLAN|STORY|SUITE)-[A-Z0-9][-A-Z0-9]*$")]


class TestWombatID:
    def test_valid_testcase_id(self):
        h = IDHolder(id="TC-PAYMENTS-REFUND-0012")
        assert h.id == "TC-PAYMENTS-REFUND-0012"

    def test_valid_shared_step_id(self):
        h = IDHolder(id="SS-LOGIN-001")
        assert h.id == "SS-LOGIN-001"

    def test_valid_plan_id(self):
        h = IDHolder(id="PLAN-RELEASE-2026")
        assert h.id == "PLAN-RELEASE-2026"

    def test_valid_story_id(self):
        h = IDHolder(id="STORY-CHECKOUT-REFUNDS")
        assert h.id == "STORY-CHECKOUT-REFUNDS"

    def test_valid_suite_id(self):
        h = IDHolder(id="SUITE-PAYMENTS-REGRESSION")
        assert h.id == "SUITE-PAYMENTS-REGRESSION"

    def test_invalid_no_prefix(self):
        with pytest.raises(ValidationError):
            IDHolder(id="PAYMENTS-REFUND-0012")

    def test_invalid_lowercase(self):
        with pytest.raises(ValidationError):
            IDHolder(id="TC-payments-refund-0012")

    def test_invalid_empty(self):
        with pytest.raises(ValidationError):
            IDHolder(id="")

    def test_invalid_prefix_only(self):
        with pytest.raises(ValidationError):
            IDHolder(id="TC-")


class TestEnums:
    def test_priority_values(self):
        assert Priority.critical.value == "critical"
        assert Priority.high.value == "high"
        assert Priority.medium.value == "medium"
        assert Priority.low.value == "low"

    def test_priority_is_string(self):
        assert isinstance(Priority.critical, str)
        assert Priority.critical == "critical"

    def test_all_enums_are_str_enums(self):
        for enum_cls in [
            Priority,
            TestCaseStatus,
            AutomationStatus,
            ReviewState,
            TestType,
            ExecutionMode,
            CoverageState,
            RiskLevel,
        ]:
            for member in enum_cls:
                assert isinstance(member, str), f"{enum_cls.__name__}.{member.name} is not a str"


class TestStep:
    def test_valid_step(self):
        s = Step(number=1, action="Click login", expected="Login page loads")
        assert s.number == 1
        assert s.action == "Click login"
        assert s.expected == "Login page loads"

    def test_step_requires_all_fields(self):
        with pytest.raises(ValidationError):
            Step(number=1, action="Click login")  # missing expected


class TestTestCase:
    def test_minimal_valid_testcase(self):
        tc = TestCase(
            id="TC-AUTH-LOGIN-0001",
            title="Basic login test",
            component="auth",
            owner="qa-team",
        )
        assert tc.id == "TC-AUTH-LOGIN-0001"
        assert tc.status == TestCaseStatus.draft
        assert tc.priority == Priority.medium
        assert tc.type == TestType.functional
        assert tc.version == 1
        assert tc.steps == []
        assert tc.tags == []

    def test_full_testcase(self):
        tc = TestCase(
            id="TC-PAYMENTS-REFUND-0012",
            title="Refund succeeds for captured card payment",
            summary="Verify refund flow",
            status=TestCaseStatus.active,
            priority=Priority.high,
            type=TestType.functional,
            component="payments",
            subcomponent="refunds",
            owner="qa-platform",
            tags=["payments", "refunds", "regression"],
            requirements=["REQ-PAY-442"],
            preconditions=["User has an order in Captured state"],
            steps=[
                Step(number=1, action="Open order details", expected="Page loads"),
                Step(number=2, action="Click Refund", expected="Dialog opens"),
            ],
            automation=AutomationInfo(
                status=AutomationStatus.candidate,
                framework="playwright",
                source="tests/e2e/payments/refund.spec.ts",
            ),
            review=ReviewInfo(state=ReviewState.approved, reviewers=["qa-lead"]),
            version=3,
            body="# Summary\nVerify refund flow.",
        )
        assert tc.component == "payments"
        assert len(tc.steps) == 2
        assert tc.automation.framework == "playwright"
        assert tc.review.state == ReviewState.approved

    def test_any_valid_wombat_id_accepted(self):
        # WombatID allows any valid prefix; prefix-to-entity check is validation-layer
        tc = TestCase(
            id="SS-AUTH-LOGIN-0001",
            title="Test",
            component="auth",
            owner="qa",
        )
        assert tc.id == "SS-AUTH-LOGIN-0001"

    def test_missing_required_fields(self):
        with pytest.raises(ValidationError):
            TestCase(id="TC-AUTH-001", title="Test")  # missing component and owner


class TestSharedStep:
    def test_minimal(self):
        ss = SharedStep(id="SS-LOGIN-001", title="Login flow", owner="qa-team")
        assert ss.id == "SS-LOGIN-001"
        assert ss.steps == []
        assert ss.variables == []
        assert ss.version == 1

    def test_with_steps_and_variables(self):
        ss = SharedStep(
            id="SS-LOGIN-001",
            title="Login flow",
            owner="qa-team",
            steps=[Step(number=1, action="Enter {username}", expected="Field populated")],
            variables=["username", "password"],
        )
        assert len(ss.steps) == 1
        assert "username" in ss.variables


class TestPlan:
    def test_minimal(self):
        p = Plan(id="PLAN-RELEASE-2026", title="Release validation")
        assert p.execution == ExecutionMode.mixed
        assert p.assignees == []

    def test_full_plan(self):
        p = Plan(
            id="PLAN-RELEASE-2026-05-PAYMENTS",
            title="Payments release validation",
            scope=ScopeSelector(product="checkout", release="2026.05"),
            include=IncludeExclude(tags_any=["payments", "critical-path"], components_any=["payments"]),
            exclude=IncludeExclude(tags_any=["deprecated"]),
            environments=[Environment(name="staging-us"), Environment(name="staging-eu")],
            execution=ExecutionMode.mixed,
            assignees=["payments-qa"],
            approvals=["qa-lead", "release-manager"],
            explicit_cases=["TC-PAYMENTS-REFUND-0012"],
        )
        assert p.scope.product == "checkout"
        assert len(p.environments) == 2
        assert "TC-PAYMENTS-REFUND-0012" in p.explicit_cases


class TestStory:
    def test_minimal(self):
        s = Story(id="STORY-CHECKOUT-REFUNDS", title="Refund capability", owner="product-team")
        assert s.coverage == CoverageState.uncovered
        assert s.risk == RiskLevel.medium

    def test_with_links(self):
        s = Story(
            id="STORY-CHECKOUT-REFUNDS",
            title="Refund capability",
            owner="product-team",
            linked_tests=["TC-PAYMENTS-REFUND-0012", "TC-PAYMENTS-REFUND-0013"],
            linked_code=["src/payments/refund.py"],
            coverage=CoverageState.covered,
            risk=RiskLevel.high,
        )
        assert len(s.linked_tests) == 2
        assert s.coverage == CoverageState.covered


class TestSuite:
    def test_minimal(self):
        s = Suite(id="SUITE-PAYMENTS-REGRESSION", title="Payments regression", owner="qa-team")
        assert s.cases == []
        assert s.tags == []

    def test_with_cases_and_include(self):
        s = Suite(
            id="SUITE-PAYMENTS-REGRESSION",
            title="Payments regression",
            owner="qa-team",
            cases=["TC-PAYMENTS-REFUND-0012"],
            include=IncludeExclude(tags_any=["regression"], components_any=["payments"]),
        )
        assert len(s.cases) == 1
