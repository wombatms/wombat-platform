"""JWT token creation and validation using PyJWT."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Literal

import jwt

from wombat_api.config import get_config


@dataclass
class TokenPayload:
    user_id: uuid.UUID
    email: str | None
    token_type: Literal["access", "refresh"]
    exp: datetime


def create_access_token(
    user_id: uuid.UUID,
    email: str,
    expires_minutes: int | None = None,
) -> str:
    """Encode a signed JWT access token."""
    cfg = get_config()
    minutes = expires_minutes if expires_minutes is not None else cfg.jwt_access_minutes
    exp = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    payload = {
        "sub": str(user_id),
        "email": email,
        "token_type": "access",
        "exp": exp,
    }
    return jwt.encode(payload, cfg.jwt_secret, algorithm="HS256")


def create_refresh_token(
    user_id: uuid.UUID,
    expires_days: int | None = None,
) -> str:
    """Encode a signed JWT refresh token (no email claim)."""
    cfg = get_config()
    days = expires_days if expires_days is not None else cfg.jwt_refresh_days
    exp = datetime.now(timezone.utc) + timedelta(days=days)
    payload = {
        "sub": str(user_id),
        "token_type": "refresh",
        "exp": exp,
    }
    return jwt.encode(payload, cfg.jwt_secret, algorithm="HS256")


def decode_token(token: str) -> TokenPayload:
    """Decode and validate a JWT, returning a TokenPayload.

    Raises jwt.ExpiredSignatureError if the token is expired, or
    jwt.InvalidTokenError for any other validation failure.
    """
    cfg = get_config()
    data = jwt.decode(token, cfg.jwt_secret, algorithms=["HS256"])
    return TokenPayload(
        user_id=uuid.UUID(data["sub"]),
        email=data.get("email"),
        token_type=data["token_type"],
        exp=datetime.fromtimestamp(data["exp"], tz=timezone.utc),
    )
