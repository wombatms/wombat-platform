"""Story/Requirement domain model."""

from __future__ import annotations

from pydantic import BaseModel

from wombat_core.models.common import CoverageState, RiskLevel, WombatID


class Story(BaseModel):
    id: WombatID
    title: str
    description: str | None = None
    coverage: CoverageState = CoverageState.uncovered
    linked_tests: list[WombatID] = []
    linked_code: list[str] = []
    linked_docs: list[str] = []
    risk: RiskLevel = RiskLevel.medium
    owner: str
    tags: list[str] = []
    version: int = 1
    body: str | None = None
