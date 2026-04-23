"""Pydantic response shapes for dashboard widgets.

Per-widget response models are added in Tasks 12-16 alongside each widget
implementation.  This module intentionally contains only the shared base so
that the registry and route dispatcher can import without circular deps.
"""

from __future__ import annotations

from pydantic import BaseModel


class WidgetResponse(BaseModel):
    """Thin envelope shared by all widget responses.

    Each widget's concrete model inherits from this and adds its own fields.
    The route handler serialises the dict returned by WidgetQuery into the
    appropriate subclass before sending it to the client.
    """

    slug: str
