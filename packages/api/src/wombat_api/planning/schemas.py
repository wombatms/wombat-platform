"""Pydantic schemas for plan/suite resolution responses and draft-resolve requests."""

from __future__ import annotations

from pydantic import BaseModel

from wombat_core.models.common import WombatID


class ResolvedCase(BaseModel):
    """A single test case in a resolved plan or suite.

    ``source`` carries one of:
    - ``"filter"`` — matched via the plan/suite include filter
    - ``"suite_ref:<id>"`` — contributed by a suite reference, e.g. ``"suite_ref:SUITE-CHECKOUT"``
    - ``"explicit_add"`` — listed in ``explicit_cases.add``
    """

    wombat_id: WombatID
    title: str
    source: str


class ResolveWarning(BaseModel):
    """A non-fatal warning produced during resolution.

    Known codes:
    - ``"UNKNOWN_SUITE_REF"`` — a ``suite_refs`` entry did not match any suite
    - ``"UNKNOWN_CASE_ID"`` — an ``explicit_cases.add`` or ``remove`` entry did not match any case
    """

    code: str
    target: str


class ResolvedPlan(BaseModel):
    """Result of resolving a plan body against the project's content."""

    cases: list[ResolvedCase]
    count: int
    warnings: list[ResolveWarning] = []


class ResolvedSuite(BaseModel):
    """Result of resolving a suite (root + subtree) against the project's content."""

    cases: list[ResolvedCase]
    count: int
    warnings: list[ResolveWarning] = []


class DraftResolveRequest(BaseModel):
    """Request body for ``POST /{project_slug}/content/resolve``.

    Accepts an unsaved draft body and returns the resolved case set without
    persisting anything.
    """

    kind: str  # "plan" | "suite"
    body: dict  # plan or suite body JSON


class StartRunDraft(BaseModel):
    """Pre-filled run creation payload derived from a plan.

    Returned by ``POST /{project_slug}/plans/{wombat_id}/start-run``.
    The caller passes this to ``POST /runs`` to actually create the run.
    """

    plan_wombat_id: WombatID
    plan_revision: str
    title_suggestion: str
    environments: list[dict]
    assignees: list[str]
    case_count: int
