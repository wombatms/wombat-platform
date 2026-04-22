"""Unit tests for the CI-account gate (assert_run_actor_authorized)."""

import pytest
from fastapi import HTTPException

from wombat_api.rbac.run_guards import assert_run_actor_authorized


@pytest.mark.asyncio
async def test_owner_passes(db_session, sample_run, sample_user):
    # No raise.
    await assert_run_actor_authorized(
        db_session,
        run=sample_run,
        user_id=sample_user.id,
        token_id=None,
        is_admin=False,
    )


@pytest.mark.asyncio
async def test_permission_without_ownership_or_admin_is_blocked(db_session, sample_run, another_user):
    with pytest.raises(HTTPException) as exc:
        await assert_run_actor_authorized(
            db_session,
            run=sample_run,
            user_id=another_user.id,
            token_id=None,
            is_admin=False,
        )
    assert exc.value.status_code == 403
    assert exc.value.detail["error"]["code"] == "unauthorized_run_action"


@pytest.mark.asyncio
async def test_assignee_passes(db_session, sample_run, another_user):
    # Add as assignee first.
    from wombat_api.database.repository import Repository

    await Repository(db_session).add_assignee(
        run_id=sample_run.id,
        user_id=another_user.id,
        added_by_user_id=sample_run.owner_id,
    )
    await db_session.commit()
    await assert_run_actor_authorized(
        db_session,
        run=sample_run,
        user_id=another_user.id,
        token_id=None,
        is_admin=False,
    )


@pytest.mark.asyncio
async def test_admin_always_passes(db_session, sample_run, another_user):
    await assert_run_actor_authorized(
        db_session,
        run=sample_run,
        user_id=another_user.id,
        token_id=None,
        is_admin=True,
    )
