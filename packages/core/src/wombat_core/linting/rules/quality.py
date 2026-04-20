"""Lint rule: quality — warn on low-quality content."""

from __future__ import annotations

from wombat_core.config.loader import WombatConfig
from wombat_core.linting.engine import LintIssue, LintRule, WombatEntity
from wombat_core.models import SharedStep, TestCase

_MIN_TITLE_LEN = 10
_MIN_STEP_TEXT_LEN = 5
_MIN_STEPS_RECOMMENDED = 2


class QualityRule(LintRule):
    name = "quality"
    description = "Warn on low-quality content: short titles, thin steps, etc."

    def check(self, entity: WombatEntity, config: WombatConfig) -> list[LintIssue]:
        issues: list[LintIssue] = []
        rule_cfg = self.get_config(config)
        min_title = int(rule_cfg.get("min_title_len", _MIN_TITLE_LEN))
        min_step_text = int(rule_cfg.get("min_step_text_len", _MIN_STEP_TEXT_LEN))
        min_steps = int(rule_cfg.get("min_steps", _MIN_STEPS_RECOMMENDED))

        # Title length
        if len(entity.title.strip()) < min_title:
            issues.append(
                LintIssue(
                    rule=self.name,
                    severity="warning",
                    message=(f"title is very short ({len(entity.title.strip())} chars); aim for at least {min_title}"),
                    entity_id=entity.id,
                    field="title",
                )
            )

        if isinstance(entity, (TestCase, SharedStep)):
            # Minimum step count
            if 0 < len(entity.steps) < min_steps:
                issues.append(
                    LintIssue(
                        rule=self.name,
                        severity="warning",
                        message=(f"only {len(entity.steps)} step(s); consider adding more (recommended ≥ {min_steps})"),
                        entity_id=entity.id,
                        field="steps",
                    )
                )

            # Step action/expected length
            for step in entity.steps:
                for field_name, text in [("action", step.action), ("expected", step.expected)]:
                    if len(text.strip()) < min_step_text:
                        issues.append(
                            LintIssue(
                                rule=self.name,
                                severity="warning",
                                message=(f"Step {step.number} {field_name} is very short; please be more descriptive"),
                                entity_id=entity.id,
                                field=f"steps[{step.number}].{field_name}",
                            )
                        )

        return issues
