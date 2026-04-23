"""Suite domain model."""

from __future__ import annotations

from pydantic import BaseModel

from wombat_core.models.common import WombatID
from wombat_core.models.plan import IncludeExclude


class Suite(BaseModel):
    id: WombatID
    title: str
    description: str | None = None
    parent_wombat_id: WombatID | None = None
    cases: list[WombatID] = []
    include: IncludeExclude = IncludeExclude()
    owner: str
    tags: list[str] = []
