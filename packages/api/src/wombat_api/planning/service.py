"""ResolveService — plan and suite resolution logic.

This module is a skeleton. Task 7 will implement the resolution methods.
The class signature is defined here so that other modules can import and
type-annotate against ``ResolveService`` without depending on Task 7.
"""

from __future__ import annotations


class ResolveService:
    """Orchestrates plan and suite resolution against the project's content.

    Args:
        repo: A ``Repository`` instance bound to the current async session.
    """

    def __init__(self, repo) -> None:
        self.repo = repo
