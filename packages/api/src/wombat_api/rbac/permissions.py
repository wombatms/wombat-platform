"""Permission definitions for SP3.2 write path."""

from __future__ import annotations

from enum import StrEnum

from wombat_api.rbac.models import Role


class Permission(StrEnum):
    CONTENT_PROPOSE = "content:propose"
    CONTENT_PUBLISH_DIRECT = "content:publish_direct"


# Role → default permissions. Overrides live on the principal (user grant or
# per-token grant) and are *additive* — never subtractive.
ROLE_DEFAULT_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.viewer: frozenset(),
    Role.editor: frozenset({Permission.CONTENT_PROPOSE}),
    Role.admin: frozenset({Permission.CONTENT_PROPOSE, Permission.CONTENT_PUBLISH_DIRECT}),
}


def role_permissions(role: Role) -> frozenset[Permission]:
    return ROLE_DEFAULT_PERMISSIONS[role]
