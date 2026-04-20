"""Lint rule: reference_integrity — cross-entity reference checks."""

from __future__ import annotations

from wombat_core.config.loader import WombatConfig
from wombat_core.linting.engine import LintIssue, LintRule, WombatEntity
from wombat_core.models import Story, Suite, TestCase


class ReferenceIntegrityRule(LintRule):
    name = "reference_integrity"
    description = "Error when an entity references a WombatID that does not exist in the corpus."

    def check(self, entity: WombatEntity, config: WombatConfig) -> list[LintIssue]:
        # Cannot check in isolation; all work done in check_corpus.
        return []

    def check_corpus(self, entities: list[WombatEntity], config: WombatConfig) -> list[LintIssue]:
        all_ids: set[str] = {e.id for e in entities}
        issues: list[LintIssue] = []

        for entity in entities:
            if isinstance(entity, TestCase):
                for ref in entity.shared_steps:
                    if ref not in all_ids:
                        issues.append(
                            LintIssue(
                                rule=self.name,
                                severity="error",
                                message=f"shared step '{ref}' not found in corpus",
                                entity_id=entity.id,
                                field="shared_steps",
                            )
                        )
                if entity.superseded_by and entity.superseded_by not in all_ids:
                    issues.append(
                        LintIssue(
                            rule=self.name,
                            severity="error",
                            message=f"superseded_by '{entity.superseded_by}' not found in corpus",
                            entity_id=entity.id,
                            field="superseded_by",
                        )
                    )

            elif isinstance(entity, Suite):
                for ref in entity.cases:
                    if ref not in all_ids:
                        issues.append(
                            LintIssue(
                                rule=self.name,
                                severity="error",
                                message=f"case '{ref}' not found in corpus",
                                entity_id=entity.id,
                                field="cases",
                            )
                        )

            elif isinstance(entity, Story):
                for ref in entity.linked_tests:
                    if ref not in all_ids:
                        issues.append(
                            LintIssue(
                                rule=self.name,
                                severity="error",
                                message=f"linked test '{ref}' not found in corpus",
                                entity_id=entity.id,
                                field="linked_tests",
                            )
                        )

        return issues
