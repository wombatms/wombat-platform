"""Common types, enums, and the WombatID type used across all domain models."""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import Field


class Priority(StrEnum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


class TestCaseStatus(StrEnum):
    draft = "draft"
    active = "active"
    deprecated = "deprecated"
    archived = "archived"


class AutomationStatus(StrEnum):
    manual = "manual"
    candidate = "candidate"
    in_progress = "in_progress"
    automated = "automated"
    not_automatable = "not_automatable"


class ReviewState(StrEnum):
    draft = "draft"
    in_review = "in_review"
    approved = "approved"
    rejected = "rejected"
    changes_requested = "changes_requested"


class TestType(StrEnum):
    functional = "functional"
    regression = "regression"
    smoke = "smoke"
    negative = "negative"
    accessibility = "accessibility"
    performance = "performance"
    security = "security"
    compatibility = "compatibility"
    api = "api"
    ui = "ui"


class ExecutionMode(StrEnum):
    manual = "manual"
    automated = "automated"
    mixed = "mixed"


class CoverageState(StrEnum):
    uncovered = "uncovered"
    partial = "partial"
    covered = "covered"


class RiskLevel(StrEnum):
    critical = "critical"
    high = "high"
    medium = "medium"
    low = "low"


WombatID = Annotated[str, Field(pattern=r"^(TC|SS|PLAN|STORY|SUITE)-[A-Z0-9][-A-Z0-9]*$")]
