"""SharedStep domain model."""

from __future__ import annotations

from pydantic import BaseModel

from wombat_core.models.common import WombatID
from wombat_core.models.testcase import Step


class SharedStep(BaseModel):
    id: WombatID
    title: str
    steps: list[Step] = []
    variables: list[str] = []
    owner: str
    tags: list[str] = []
    version: int = 1
    body: str | None = None
