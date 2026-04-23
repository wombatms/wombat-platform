"""Plan domain model and related types."""

from __future__ import annotations

from pydantic import BaseModel

from wombat_core.models.common import ExecutionMode, Priority, WombatID


class ScopeSelector(BaseModel):
    product: str | None = None
    release: str | None = None


class IncludeExclude(BaseModel):
    tags_any: list[str] = []
    tags_all: list[str] = []
    components_any: list[str] = []
    priorities: list[Priority] = []


class Environment(BaseModel):
    name: str
    config: dict[str, str] = {}


class ExplicitCases(BaseModel):
    """Additive and subtractive overrides applied on top of filter + suite_refs resolution."""

    add: list[WombatID] = []
    remove: list[WombatID] = []


class Plan(BaseModel):
    id: WombatID
    title: str
    description: str | None = None
    scope: ScopeSelector = ScopeSelector()
    include: IncludeExclude = IncludeExclude()
    exclude: IncludeExclude = IncludeExclude()
    suite_refs: list[WombatID] = []
    environments: list[Environment] = []
    execution: ExecutionMode = ExecutionMode.mixed
    assignees: list[str] = []
    approvals: list[str] = []
    explicit_cases: ExplicitCases = ExplicitCases()
