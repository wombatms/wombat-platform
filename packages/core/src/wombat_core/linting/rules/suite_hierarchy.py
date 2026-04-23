"""Lint rules for suite hierarchy (SP3.4).

Covers three new checks:

* ``suite_self_parent`` (error) — a Suite declares itself as its own parent.
* ``suite_cycle`` (error) — a cycle exists in the parent_wombat_id chain.
* ``plan_suite_ref_unknown`` (warning) — a Plan.suite_refs entry points at
  a WombatID that is not a known Suite in the corpus.

Single-parent tree only. These are the Git-source-of-truth guardrails;
proposal-write paths enforce the same invariants at service layer.
"""

from __future__ import annotations

from wombat_core.config.loader import WombatConfig
from wombat_core.linting.engine import LintIssue, LintRule, WombatEntity
from wombat_core.models import Plan, Suite

# Defensive hard cap — matches the repository's list_suite_subtree depth limit.
MAX_SUITE_DEPTH = 20


class SuiteSelfParentRule(LintRule):
    """A suite is its own parent — rejected at lint time as an error."""

    name = "suite_self_parent"
    description = "Error when a Suite declares itself as parent_wombat_id."

    def check(self, entity: WombatEntity, config: WombatConfig) -> list[LintIssue]:
        if not isinstance(entity, Suite):
            return []
        if entity.parent_wombat_id is not None and entity.parent_wombat_id == entity.id:
            return [
                LintIssue(
                    rule=self.name,
                    severity="error",
                    message=f"suite '{entity.id}' is its own parent",
                    entity_id=entity.id,
                    field="parent_wombat_id",
                )
            ]
        return []


class SuiteCycleRule(LintRule):
    """A cycle exists in the parent_wombat_id chain — rejected as error."""

    name = "suite_cycle"
    description = "Error when suites form a parent_wombat_id cycle."

    def check(self, entity: WombatEntity, config: WombatConfig) -> list[LintIssue]:
        # Corpus-level only: one suite in isolation cannot form a cycle.
        return []

    def check_corpus(
        self, entities: list[WombatEntity], config: WombatConfig
    ) -> list[LintIssue]:
        suites_by_id: dict[str, Suite] = {
            e.id: e for e in entities if isinstance(e, Suite)
        }
        issues: list[LintIssue] = []
        seen_cycle_ids: set[frozenset[str]] = set()

        for start in suites_by_id.values():
            if start.parent_wombat_id is None or start.parent_wombat_id == start.id:
                # Self-parent is a different rule; don't double-report here.
                continue

            visited: list[str] = [start.id]
            current_id: str | None = start.parent_wombat_id
            depth = 0
            cycle_members: set[str] | None = None

            while current_id is not None and depth < MAX_SUITE_DEPTH:
                if current_id in visited:
                    # Found a cycle. Capture the cycle members (from where it
                    # closes onward) so we can dedupe identical cycles found
                    # from different starting suites.
                    cut = visited.index(current_id)
                    cycle_members = set(visited[cut:])
                    break
                visited.append(current_id)
                nxt = suites_by_id.get(current_id)
                if nxt is None:
                    # Unknown parent — not a cycle for our purposes.
                    break
                if nxt.parent_wombat_id is None or nxt.parent_wombat_id == nxt.id:
                    break
                current_id = nxt.parent_wombat_id
                depth += 1

            if cycle_members is not None:
                key = frozenset(cycle_members)
                if key in seen_cycle_ids:
                    continue
                seen_cycle_ids.add(key)
                for eid in sorted(cycle_members):
                    issues.append(
                        LintIssue(
                            rule=self.name,
                            severity="error",
                            message=(
                                f"suite '{eid}' participates in a parent chain cycle: "
                                + " -> ".join(sorted(cycle_members))
                            ),
                            entity_id=eid,
                            field="parent_wombat_id",
                        )
                    )

        return issues


class PlanSuiteRefUnknownRule(LintRule):
    """Warn when a Plan.suite_refs entry points at an unknown Suite."""

    name = "plan_suite_ref_unknown"
    description = (
        "Warning when a Plan references a suite_refs WombatID that is not a "
        "known Suite in the corpus."
    )

    def check(self, entity: WombatEntity, config: WombatConfig) -> list[LintIssue]:
        # Corpus-level: requires the full set of suite IDs.
        return []

    def check_corpus(
        self, entities: list[WombatEntity], config: WombatConfig
    ) -> list[LintIssue]:
        suite_ids: set[str] = {e.id for e in entities if isinstance(e, Suite)}
        issues: list[LintIssue] = []
        for entity in entities:
            if not isinstance(entity, Plan):
                continue
            for ref in entity.suite_refs:
                if ref not in suite_ids:
                    issues.append(
                        LintIssue(
                            rule=self.name,
                            severity="warning",
                            message=f"suite_refs entry '{ref}' not found in corpus",
                            entity_id=entity.id,
                            field="suite_refs",
                        )
                    )
        return issues
