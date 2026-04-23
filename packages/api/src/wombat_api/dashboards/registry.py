"""Widget registry contract for the dashboards subpackage.

Each widget is registered by importing its module (side-effect pattern).
Tasks 12-16 add the concrete widget implementations; they call
``REGISTRY.register(meta, query)`` at import time.

The route dispatcher (Task 17) validates scope / required filters before
invoking a query function.
"""

from collections.abc import Awaitable, Callable
from typing import Literal, TypedDict

from sqlalchemy.ext.asyncio import AsyncSession

ScopeKind = Literal["project", "plan"]


class WidgetScope(TypedDict):
    kind: ScopeKind
    project_id: str  # uuid str
    plan_wombat_id: str | None


class WidgetFilters(TypedDict, total=False):
    window: Literal["7d", "30d", "90d", "all"]
    env_id: str | None
    plan_id: str | None  # for project-scope plan filter


class WidgetMeta(TypedDict):
    slug: str
    title: str
    scope_kinds: set[ScopeKind]
    requires: list[str]  # required keys in filters (e.g. ["plan_id"] for release_readiness on project)


WidgetQuery = Callable[[WidgetScope, WidgetFilters, AsyncSession], Awaitable[dict]]


class WidgetRegistry:
    def __init__(self) -> None:
        self._items: dict[str, tuple[WidgetMeta, WidgetQuery]] = {}

    def register(self, meta: WidgetMeta, query: WidgetQuery) -> None:
        """Register a widget under its slug.

        Calling register() a second time with the same slug overwrites the
        previous entry — useful for hot-reloading in tests.
        """
        self._items[meta["slug"]] = (meta, query)

    def get(self, slug: str) -> tuple[WidgetMeta, WidgetQuery]:
        """Return (meta, query) for *slug*, or raise KeyError if unknown."""
        if slug not in self._items:
            raise KeyError(slug)
        return self._items[slug]

    def list_meta(self) -> list[WidgetMeta]:
        """Return meta dicts for all registered widgets (insertion order)."""
        return [m for m, _ in self._items.values()]


REGISTRY = WidgetRegistry()
