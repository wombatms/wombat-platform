"""Lint rule: id_format — verify the WombatID prefix matches the entity type."""

from __future__ import annotations

from wombat_core.config.loader import WombatConfig
from wombat_core.linting.engine import LintIssue, LintRule, WombatEntity
from wombat_core.models import Plan, SharedStep, Story, Suite, TestCase

_EXPECTED_PREFIX: dict[type, str] = {
    TestCase: "TC",
    SharedStep: "SS",
    Plan: "PLAN",
    Story: "STORY",
    Suite: "SUITE",
}


class IDFormatRule(LintRule):
    name = "id_format"
    description = "Error when the WombatID prefix does not match the entity type."

    def check(self, entity: WombatEntity, config: WombatConfig) -> list[LintIssue]:
        expected = _EXPECTED_PREFIX.get(type(entity))
        if expected is None:
            return []
        prefix = entity.id.split("-", 1)[0]
        if prefix != expected:
            return [
                LintIssue(
                    rule=self.name,
                    severity="error",
                    message=(
                        f"ID prefix '{prefix}' does not match entity type "
                        f"'{type(entity).__name__}' (expected '{expected}-…')"
                    ),
                    entity_id=entity.id,
                    field="id",
                )
            ]
        return []
