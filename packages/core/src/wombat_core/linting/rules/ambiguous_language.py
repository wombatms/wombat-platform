"""Lint rule: ambiguous_language — flag vague words in text fields."""

from __future__ import annotations

import re

from wombat_core.config.loader import WombatConfig
from wombat_core.linting.engine import LintIssue, LintRule, WombatEntity
from wombat_core.models import SharedStep, TestCase

# Words that indicate vague / non-deterministic language
_VAGUE_WORDS: tuple[str, ...] = (
    "sometimes",
    "usually",
    "maybe",
    "probably",
    "often",
    "rarely",
    "occasionally",
    "generally",
    "typically",
    "might",
    "could",
    "may",
    "should",
    "several",
    "few",
    "many",
    "quickly",
    "slowly",
    "easily",
    "briefly",
    "approximately",
    "roughly",
)

# Pre-compile a single pattern that matches any vague word as a whole word
_VAGUE_RE = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in _VAGUE_WORDS) + r")\b",
    re.IGNORECASE,
)


def _find_vague(text: str) -> list[str]:
    return list({m.group(0).lower() for m in _VAGUE_RE.finditer(text)})


class AmbiguousLanguageRule(LintRule):
    name = "ambiguous_language"
    description = "Warn when step text or descriptions contain vague/non-deterministic language."

    def check(self, entity: WombatEntity, config: WombatConfig) -> list[LintIssue]:
        issues: list[LintIssue] = []

        if isinstance(entity, (TestCase, SharedStep)):
            for step in entity.steps:
                for field_name, text in [("action", step.action), ("expected", step.expected)]:
                    found = _find_vague(text)
                    if found:
                        issues.append(
                            LintIssue(
                                rule=self.name,
                                severity="warning",
                                message=(
                                    f"Step {step.number} {field_name} contains ambiguous "
                                    f"language: {', '.join(sorted(found))}"
                                ),
                                entity_id=entity.id,
                                field=f"steps[{step.number}].{field_name}",
                            )
                        )

        if isinstance(entity, TestCase):
            for field_name in ("title", "summary"):
                text = getattr(entity, field_name, None) or ""
                found = _find_vague(text)
                if found:
                    issues.append(
                        LintIssue(
                            rule=self.name,
                            severity="warning",
                            message=(
                                f"{field_name} contains ambiguous language: "
                                f"{', '.join(sorted(found))}"
                            ),
                            entity_id=entity.id,
                            field=field_name,
                        )
                    )

        return issues
