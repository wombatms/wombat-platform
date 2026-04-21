"""FastAPI authentication dependencies."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.auth.jwt import decode_token
from wombat_api.database.engine import get_session
from wombat_api.database.models import APITokenDB, UserDB
from wombat_api.database.repository import Repository
from wombat_api.rbac.models import Role
from wombat_api.rbac.permissions import Permission, role_permissions

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


@dataclass(frozen=True)
class Principal:
    user: UserDB
    # None for JWT-session principals; the token row for API-token principals.
    token: APITokenDB | None
    kind: str  # "human" | "agent"

    def permissions(self, role: Role) -> frozenset[Permission]:
        base = set(role_permissions(role))
        if self.token is not None and self.token.publish_direct:
            base.add(Permission.CONTENT_PUBLISH_DIRECT)
        # NOTE: per-user additive grants (editor with explicit publish_direct) live
        # in a future user_permission_grants table. Out of scope for SP3.2 code;
        # admin-grantable-per-user surface is covered by the admin role for MVP.
        return frozenset(base)


async def _resolve_principal(
    token: str,
    session: AsyncSession,
) -> Principal:
    """Shared resolution logic: returns a Principal with user + optional token row."""
    if token.startswith("wombat_"):
        # API token path: only the hash is stored, never the raw secret.
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        repo = Repository(session)
        token_row = await repo.get_token_by_hash(token_hash)
        if token_row is None:
            raise HTTPException(status_code=401, detail="Invalid API token")
        if token_row.expires_at is not None and datetime.now(UTC) >= token_row.expires_at:
            raise HTTPException(status_code=401, detail="API token expired")
        user = await session.get(UserDB, token_row.user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return Principal(user=user, token=token_row, kind="agent")
    else:
        # JWT path
        try:
            payload = decode_token(token)
        except Exception as exc:
            raise HTTPException(status_code=401, detail="Invalid or expired token") from exc
        if payload.token_type != "access":
            raise HTTPException(status_code=401, detail="Expected access token")
        user = await session.get(UserDB, payload.user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return Principal(user=user, token=None, kind="human")


async def get_principal(
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> Principal:
    """Resolve the bearer token to a Principal (user + optional API token row)."""
    return await _resolve_principal(token, session)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> UserDB:
    """Resolve the bearer token to a UserDB.

    Accepts either:
    - An API token prefixed with ``wombat_`` — sha256-hashed and looked up in DB.
    - A JWT access token — decoded and verified with the configured secret.

    Raises HTTP 401 on any authentication failure.
    """
    principal = await _resolve_principal(token, session)
    return principal.user
