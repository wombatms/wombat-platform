"""Lint rule: taxonomy — validate components/environments against config."""

from __future__ import annotations

from wombat_core.config.loader import WombatConfig
from wombat_core.linting.engine import LintIssue, LintRule, WombatEntity
from wombat_core.models import Plan, Suite, TestCase


class TaxonomyRule(LintRule):
    name = "taxonomy"
    description = (
        "Warn when component or environment names are not in the configured taxonomy lists."
    )

    def check(self, entity: WombatEntity, config: WombatConfig) -> list[LintIssue]:
        issues: list[LintIssue] = []
        components = config.taxonomy.components
        environments = config.taxonomy.environments

        if isinstance(entity, (TestCase, Suite)) and components:
            component = getattr(entity, "component", None)
            if component and component not in components:
                issues.append(
                    LintIssue(
                        rule=self.name,
                        severity="warning",
                        message=(
                            f"component '{component}' is not in the configured taxonomy "
                            f"({', '.join(components)})"
                        ),
                        entity_id=entity.id,
                        field="component",
                    )
                )

        if isinstance(entity, Plan) and environments:
            for env in entity.environments:
                if env.name not in environments:
                    issues.append(
                        LintIssue(
                            rule=self.name,
                            severity="warning",
                            message=(
                                f"environment '{env.name}' is not in the configured taxonomy "
                                f"({', '.join(environments)})"
                            ),
                            entity_id=entity.id,
                            field="environments",
                        )
                    )

        return issues
