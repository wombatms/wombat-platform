"""Permission definitions for SP3.2 write path."""

from __future__ import annotations

from enum import StrEnum

from wombat_api.rbac.models import Role


class Permission(StrEnum):
    CONTENT_PROPOSE = "content:propose"
    CONTENT_PUBLISH_DIRECT = "content:publish_direct"
    RUNS_READ = "runs:read"
    RUNS_CREATE = "runs:create"
    RUNS_RECORD = "runs:record"
    RUNS_CLOSE = "runs:close"
    RUNS_REOPEN = "runs:reopen"


# Role → default permissions. Overrides live on the principal (user grant or
# per-token grant) and are *additive* — never subtractive.
ROLE_DEFAULT_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.viewer: frozenset({Permission.RUNS_READ}),
    Role.editor: frozenset({
        Permission.CONTENT_PROPOSE,
        Permission.RUNS_READ,
        Permission.RUNS_CREATE,
        Permission.RUNS_RECORD,
        Permission.RUNS_CLOSE,
    }),
    Role.admin: frozenset({
        Permission.CONTENT_PROPOSE,
        Permission.CONTENT_PUBLISH_DIRECT,
        Permission.RUNS_READ,
        Permission.RUNS_CREATE,
        Permission.RUNS_RECORD,
        Permission.RUNS_CLOSE,
        Permission.RUNS_REOPEN,
    }),
}


def role_permissions(role: Role) -> frozenset[Permission]:
    return ROLE_DEFAULT_PERMISSIONS[role]
