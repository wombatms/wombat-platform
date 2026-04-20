"""Shared fixtures for CLI integration tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from wombat_core.models.plan import Plan
from wombat_core.models.shared_step import SharedStep
from wombat_core.models.story import Story
from wombat_core.models.testcase import Step, TestCase
from wombat_core.parsing.writer import write_entity


@pytest.fixture
def runner() -> CliRunner:
    """Typer CliRunner with isolated filesystem."""
    return CliRunner()


@pytest.fixture
def init_dir(tmp_path: Path) -> Path:
    """A bare temp directory suitable for `wombat init`."""
    return tmp_path


@pytest.fixture
def project_dir(tmp_path: Path) -> Path:
    """A temp directory with a fully initialised .wombat/ project."""
    wombat_dir = tmp_path / ".wombat"
    wombat_dir.mkdir()
    config = wombat_dir / "config.yaml"
    config.write_text(
        """\
project:
  id: integration-test
  name: Integration Test
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

lint:
  rules: {}

id:
  auto_sequence: true
"""
    )
    for subdir in ["testcases", "shared-steps", "plans", "stories", "suites"]:
        (wombat_dir / subdir).mkdir()
    return tmp_path


@pytest.fixture
def populated_project(project_dir: Path) -> Path:
    """project_dir pre-populated with several entities."""
    wombat_dir = project_dir / ".wombat"

    tc1 = TestCase(
        id="TC-AUTH-LOGIN-0001",
        title="User logs in with valid credentials",
        summary="Verify login flow.",
        component="auth",
        owner="qa-auth-team",
        tags=["auth", "smoke"],
        steps=[Step(number=1, action="Navigate to /login", expected="Login page loads")],
    )
    tc2 = TestCase(
        id="TC-PAYMENTS-CHECKOUT-0001",
        title="Checkout completes with valid card",
        summary="Verify checkout.",
        component="payments",
        owner="qa-platform",
        tags=["payments", "regression"],
        steps=[Step(number=1, action="Add item to cart", expected="Cart updates")],
    )
    ss = SharedStep(
        id="SS-LOGIN-001",
        title="Standard login steps",
        owner="qa-auth-team",
        variables=["email", "password"],
        steps=[Step(number=1, action="Enter {email}", expected="Field populated")],
    )
    plan = Plan(id="PLAN-REGRESSION", title="Regression plan")
    story = Story(
        id="STORY-AUTH-LOGIN",
        title="Users can log in",
        owner="product-team",
        linked_tests=["TC-AUTH-LOGIN-0001"],
    )

    write_entity(tc1, wombat_dir / "testcases" / "tc-auth-login-0001.md")
    write_entity(tc2, wombat_dir / "testcases" / "tc-payments-checkout-0001.md")
    write_entity(ss, wombat_dir / "shared-steps" / "ss-login-001.md")
    write_entity(plan, wombat_dir / "plans" / "plan-regression.yaml")
    write_entity(story, wombat_dir / "stories" / "story-auth-login.md")

    return project_dir


def parse_json_output(output: str) -> dict | list:
    """Parse JSON from CLI output, stripping any leading non-JSON lines."""
    lines = output.strip().splitlines()
    # Find first line starting with { or [
    for i, line in enumerate(lines):
        if line.startswith("{") or line.startswith("["):
            return json.loads("\n".join(lines[i:]))
    return json.loads(output)
