"""Lint rule: required_fields — warn about empty/missing recommended fields."""

from __future__ import annotations

from wombat_core.config.loader import WombatConfig
from wombat_core.linting.engine import LintIssue, LintRule, WombatEntity
from wombat_core.models import SharedStep, TestCase


class RequiredFieldsRule(LintRule):
    name = "required_fields"
    description = (
        "Warn when recommended fields are absent or when required string fields are blank."
    )

    def check(self, entity: WombatEntity, config: WombatConfig) -> list[LintIssue]:
        issues: list[LintIssue] = []

        # All entities: title must not be blank
        if not entity.title.strip():
            issues.append(
                LintIssue(
                    rule=self.name,
                    severity="error",
                    message="title must not be blank",
                    entity_id=entity.id,
                    field="title",
                )
            )

        if isinstance(entity, TestCase):
            # component / owner must not be blank
            if not entity.component.strip():
                issues.append(
                    LintIssue(
                        rule=self.name,
                        severity="error",
                        message="component must not be blank",
                        entity_id=entity.id,
                        field="component",
                    )
                )
            if not entity.owner.strip():
                issues.append(
                    LintIssue(
                        rule=self.name,
                        severity="error",
                        message="owner must not be blank",
                        entity_id=entity.id,
                        field="owner",
                    )
                )
            # Recommended: summary
            if not entity.summary:
                issues.append(
                    LintIssue(
                        rule=self.name,
                        severity="warning",
                        message="summary is recommended for test cases",
                        entity_id=entity.id,
                        field="summary",
                    )
                )
            # Recommended: at least one step
            if not entity.steps:
                issues.append(
                    LintIssue(
                        rule=self.name,
                        severity="warning",
                        message="test case has no steps",
                        entity_id=entity.id,
                        field="steps",
                    )
                )

        if isinstance(entity, SharedStep):
            if not entity.owner.strip():
                issues.append(
                    LintIssue(
                        rule=self.name,
                        severity="error",
                        message="owner must not be blank",
                        entity_id=entity.id,
                        field="owner",
                    )
                )
            if not entity.steps:
                issues.append(
                    LintIssue(
                        rule=self.name,
                        severity="warning",
                        message="shared step block has no steps",
                        entity_id=entity.id,
                        field="steps",
                    )
                )

        return issues
