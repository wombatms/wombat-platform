"""TestCase domain model and related types."""

from __future__ import annotations

from pydantic import BaseModel

from wombat_core.models.common import (
    AutomationStatus,
    Priority,
    ReviewState,
    TestCaseStatus,
    TestType,
    WombatID,
)


class Step(BaseModel):
    number: int
    action: str
    expected: str


class AutomationInfo(BaseModel):
    status: AutomationStatus = AutomationStatus.manual
    framework: str | None = None
    source: str | None = None


class ReviewInfo(BaseModel):
    state: ReviewState = ReviewState.draft
    reviewers: list[str] = []


class TestCase(BaseModel):
    id: WombatID
    title: str
    summary: str | None = None
    status: TestCaseStatus = TestCaseStatus.draft
    priority: Priority = Priority.medium
    type: TestType = TestType.functional
    component: str
    subcomponent: str | None = None
    owner: str
    tags: list[str] = []
    requirements: list[str] = []
    preconditions: list[str] = []
    test_data: list[str] = []
    shared_steps: list[WombatID] = []
    steps: list[Step] = []
    automation: AutomationInfo = AutomationInfo()
    review: ReviewInfo = ReviewInfo()
    version: int = 1
    change_reason: str | None = None
    superseded_by: WombatID | None = None
    environment_constraints: list[str] = []
    body: str | None = None
