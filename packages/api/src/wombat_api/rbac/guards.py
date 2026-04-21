"""Write-path guards used by proposal routes."""

from __future__ import annotations

from fastapi import HTTPException

from wombat_api.auth.dependencies import Principal
from wombat_api.database.models import ProposalDB
from wombat_api.rbac.models import Role
from wombat_api.rbac.permissions import Permission


def forbid_self_approval(proposal: ProposalDB, principal: Principal) -> None:
    """Raise 403 self_approval_forbidden if the principal authored this proposal.

    Applied uniformly to JWT sessions and API tokens whose user is the author.
    """
    if proposal.author_user_id == principal.user.id:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "self_approval_forbidden",
                "message": "Authors cannot approve their own proposals. "
                           "Use direct-publish if you have the permission, "
                           "or wait for another admin.",
            },
        )


def require_direct_publish(
    principal: Principal, role: Role, auto_approve: bool
) -> None:
    """When auto_approve=True on CREATE, verify the principal has publish_direct.

    Ignored (and treated as False) on any other route — enforced at the route
    layer by not exposing auto_approve as a query parameter elsewhere.
    """
    if not auto_approve:
        return
    if Permission.CONTENT_PUBLISH_DIRECT not in principal.permissions(role):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "direct_publish_not_permitted",
                "message": "auto_approve=true requires content:publish_direct",
            },
        )
