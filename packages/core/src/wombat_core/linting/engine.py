"""Lint engine: LintRule ABC and LintEngine orchestrator."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from wombat_core.config.loader import WombatConfig
from wombat_core.models import Plan, SharedStep, Story, Suite, TestCase

WombatEntity = TestCase | SharedStep | Plan | Story | Suite


@dataclass
class LintIssue:
    rule: str
    severity: str  # "error" | "warning"
    message: str
    entity_id: str
    field: str | None = None


class LintRule(ABC):
    """Base class for all lint rules."""

    #: Unique machine-readable name used in config (e.g. ``required_fields``).
    name: str = ""
    #: Human-readable description shown in ``wombat lint --list``.
    description: str = ""

    def is_enabled(self, config: WombatConfig) -> bool:
        """Return True unless the rule is explicitly disabled in config."""
        rule_cfg = config.lint.rules.get(self.name)
        if rule_cfg is None:
            return True
        if isinstance(rule_cfg, dict):
            return bool(rule_cfg.get("enabled", True))
        # Allow bare ``false`` to disable
        return bool(rule_cfg)

    def get_config(self, config: WombatConfig) -> dict:
        """Return rule-specific config dict (or empty dict)."""
        rule_cfg = config.lint.rules.get(self.name, {})
        return rule_cfg if isinstance(rule_cfg, dict) else {}

    @abstractmethod
    def check(self, entity: WombatEntity, config: WombatConfig) -> list[LintIssue]:
        """Check a single entity; return any issues found."""
        ...

    def check_corpus(
        self, entities: list[WombatEntity], config: WombatConfig
    ) -> list[LintIssue]:
        """Corpus-level check.  Default: call check() on every entity."""
        issues: list[LintIssue] = []
        for entity in entities:
            issues.extend(self.check(entity, config))
        return issues


class LintEngine:
    """Orchestrates lint rules over entities."""

    def __init__(
        self,
        config: WombatConfig,
        rules: list[LintRule] | None = None,
    ) -> None:
        self.config = config
        if rules is None:
            from wombat_core.linting.rules import default_rules

            self.rules: list[LintRule] = default_rules()
        else:
            self.rules = rules

    def _active_rules(self) -> list[LintRule]:
        return [r for r in self.rules if r.is_enabled(self.config)]

    def lint_entity(self, entity: WombatEntity) -> list[LintIssue]:
        """Run all enabled rules against a single entity."""
        issues: list[LintIssue] = []
        for rule in self._active_rules():
            issues.extend(rule.check(entity, self.config))
        return issues

    def lint_corpus(self, entities: list[WombatEntity]) -> list[LintIssue]:
        """Run all enabled rules against the full corpus (enables cross-entity rules)."""
        issues: list[LintIssue] = []
        for rule in self._active_rules():
            issues.extend(rule.check_corpus(entities, self.config))
        return issues
