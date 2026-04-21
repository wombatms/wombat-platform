"""Unit tests for the Permission enum and role->permissions map."""

from unittest.mock import MagicMock

import pytest

from wombat_api.auth.dependencies import Principal
from wombat_api.rbac.models import Role
from wombat_api.rbac.permissions import Permission, role_permissions


@pytest.mark.parametrize(
    "role, expected",
    [
        (Role.viewer, set()),
        (Role.editor, {Permission.CONTENT_PROPOSE}),
        (Role.admin, {Permission.CONTENT_PROPOSE, Permission.CONTENT_PUBLISH_DIRECT}),
    ],
)
def test_role_permissions(role, expected):
    assert set(role_permissions(role)) == expected


def test_api_token_without_grant_uses_role_only():
    principal = Principal(user=MagicMock(), token=MagicMock(publish_direct=False), kind="agent")
    assert Permission.CONTENT_PUBLISH_DIRECT not in principal.permissions(Role.editor)


def test_api_token_with_grant_adds_publish_direct():
    principal = Principal(user=MagicMock(), token=MagicMock(publish_direct=True), kind="agent")
    assert Permission.CONTENT_PUBLISH_DIRECT in principal.permissions(Role.editor)
