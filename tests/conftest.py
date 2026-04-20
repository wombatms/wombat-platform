"""Shared pytest fixtures for unit and integration tests."""

from __future__ import annotations

from pathlib import Path

import pytest

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

# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).parent.parent
FIXTURES_DIR = REPO_ROOT / "fixtures"


@pytest.fixture
def fixture_dir() -> Path:
    """Path to the fixtures/ directory in the repo."""
    return FIXTURES_DIR


@pytest.fixture
def valid_fixtures_dir(fixture_dir: Path) -> Path:
    return fixture_dir


@pytest.fixture
def invalid_fixtures_dir(fixture_dir: Path) -> Path:
    return fixture_dir / "invalid"


# ---------------------------------------------------------------------------
# Domain model fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_step() -> Step:
    return Step(
        number=1,
        action="Click the Submit button",
        expected="Form is submitted successfully",
    )


@pytest.fixture
def sample_test_case() -> TestCase:
    return TestCase(
        id="TC-AUTH-LOGIN-0001",
        title="User logs in with valid credentials",
        summary="Verify that a registered user can authenticate.",
        status=TestCaseStatus.active,
        priority=Priority.high,
        type=TestType.functional,
        component="auth",
        subcomponent="login",
        owner="qa-auth-team",
        tags=["auth", "login", "smoke"],
        requirements=["REQ-AUTH-001"],
        preconditions=["User account exists with email test@example.com"],
        steps=[
            Step(number=1, action="Navigate to /login", expected="Login page loads"),
            Step(number=2, action="Enter valid credentials", expected="Fields populated"),
            Step(number=3, action="Click Sign In", expected="Dashboard loads"),
        ],
        automation=AutomationInfo(
            status=AutomationStatus.automated,
            framework="playwright",
            source="tests/e2e/auth/login.spec.ts",
        ),
        review=ReviewInfo(state=ReviewState.approved, reviewers=["qa-lead"]),
        version=1,
    )


@pytest.fixture
def sample_shared_step() -> SharedStep:
    return SharedStep(
        id="SS-LOGIN-001",
        title="Standard login via email and password",
        owner="qa-auth-team",
        tags=["auth"],
        variables=["email", "password", "expected_redirect"],
        steps=[
            Step(number=1, action="Navigate to /login", expected="Login page loads"),
            Step(number=2, action="Enter {email} in email field", expected="Field populated"),
            Step(number=3, action="Enter {password} in password field", expected="Field populated"),
            Step(number=4, action="Click Sign In", expected="Redirected to {expected_redirect}"),
        ],
        version=1,
    )


@pytest.fixture
def sample_plan() -> Plan:
    return Plan(
        id="PLAN-PAYMENTS-REGRESSION",
        title="Payments Component Regression",
        description="Full regression for the payments component.",
        scope=ScopeSelector(product="wombat-shop"),
        include=IncludeExclude(
            components_any=["payments"],
            priorities=[Priority.critical, Priority.high],
        ),
        exclude=IncludeExclude(tags_any=["deprecated"]),
        environments=[
            Environment(name="staging-us", config={"base_url": "https://staging.example.com"}),
        ],
        execution=ExecutionMode.mixed,
        assignees=["qa-platform"],
        approvals=["qa-lead"],
    )


@pytest.fixture
def sample_story() -> Story:
    return Story(
        id="STORY-CHECKOUT-REFUNDS",
        title="Customers can request refunds for completed orders",
        description="As a customer, I want to request refunds.",
        coverage=CoverageState.covered,
        linked_tests=["TC-AUTH-LOGIN-0001"],
        risk=RiskLevel.high,
        owner="product-team",
        tags=["payments", "refunds"],
        version=1,
    )


@pytest.fixture
def sample_suite() -> Suite:
    return Suite(
        id="SUITE-PAYMENTS-REGRESSION",
        title="Payments Regression Suite",
        description="All regression tests for payments.",
        cases=["TC-AUTH-LOGIN-0001"],
        include=IncludeExclude(components_any=["payments"], tags_any=["regression"]),
        owner="qa-platform",
        tags=["payments", "regression"],
    )


# ---------------------------------------------------------------------------
# Wombat project directory
# ---------------------------------------------------------------------------


@pytest.fixture
def wombat_project(tmp_path: Path) -> Path:
    """Create a minimal .wombat/ project in a temp directory.

    Returns the project root (not the .wombat/ subdir).
    """
    wombat_dir = tmp_path / ".wombat"
    wombat_dir.mkdir()
    config = wombat_dir / "config.yaml"
    config.write_text(
        """\
project:
  id: test-project
  name: Test Project
  org: test-org
  default_owner: qa-team

taxonomy:
  components:
    - auth
    - payments
    - checkout
  environments:
    - staging-us
    - staging-eu
    - prod

lint:
  rules: {}

id:
  auto_sequence: false
"""
    )
    # Create entity subdirs
    for subdir in ["testcases", "shared-steps", "plans", "stories", "suites"]:
        (wombat_dir / subdir).mkdir()
    return tmp_path


@pytest.fixture
def wombat_dir(wombat_project: Path) -> Path:
    """Return the .wombat/ directory within the temp project."""
    return wombat_project / ".wombat"
