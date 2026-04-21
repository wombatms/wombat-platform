"""Unit tests for write-path guards: self-approval + auto_approve gating."""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from wombat_api.rbac.guards import forbid_self_approval, require_direct_publish
from wombat_api.rbac.models import Role


def test_self_approval_raises_403():
    user_id = MagicMock()
    principal = MagicMock(user=MagicMock(id=user_id))
    proposal = MagicMock(author_user_id=user_id)
    with pytest.raises(HTTPException) as exc:
        forbid_self_approval(proposal, principal)
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "self_approval_forbidden"


def test_self_approval_allowed_for_different_author():
    principal = MagicMock(user=MagicMock(id="X"))
    proposal = MagicMock(author_user_id="Y")
    forbid_self_approval(proposal, principal)  # no raise


def test_auto_approve_requires_direct_publish_permission():
    principal = MagicMock()
    principal.permissions.return_value = frozenset()
    with pytest.raises(HTTPException) as exc:
        require_direct_publish(principal, Role.editor, auto_approve=True)
    assert exc.value.detail["code"] == "direct_publish_not_permitted"


def test_auto_approve_false_is_allowed():
    principal = MagicMock()
    principal.permissions.return_value = frozenset()
    require_direct_publish(principal, Role.viewer, auto_approve=False)  # no raise
