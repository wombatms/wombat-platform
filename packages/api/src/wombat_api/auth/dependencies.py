"""FastAPI authentication dependencies."""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime

from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.auth.jwt import decode_token
from wombat_api.database.engine import get_session
from wombat_api.database.models import UserDB
from wombat_api.database.repository import Repository

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


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
        return user
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
        return user
