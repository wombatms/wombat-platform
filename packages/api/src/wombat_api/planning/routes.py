"""Planning routes.

This module is a skeleton. Tasks 8–10 will add the concrete endpoints:
- POST  /{project_slug}/content/resolve
- POST  /{project_slug}/plans/{wombat_id}/clone
- GET   /{project_slug}/plans/{wombat_id}/resolve
- POST  /{project_slug}/plans/{wombat_id}/start-run
- GET   /{project_slug}/suites/tree
- GET   /{project_slug}/suites/{wombat_id}/resolve
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()
