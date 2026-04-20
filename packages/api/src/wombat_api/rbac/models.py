"""RBAC role definitions."""

from __future__ import annotations

from enum import IntEnum


class Role(IntEnum):
    """Role hierarchy: higher value == more privilege.

    Use ``Role[role_str]`` for name-based lookup (e.g. ``Role["editor"]``).
    Comparison is done with ``>=``: ``Role.admin >= Role.editor`` is True.
    """

    viewer = 1
    editor = 2
    admin = 3
