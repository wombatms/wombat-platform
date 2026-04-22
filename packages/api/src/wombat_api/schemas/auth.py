"""Auth request/response schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator


class RegisterRequest(BaseModel):
    email: str
    password: str
    display_name: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class CreateAPITokenRequest(BaseModel):
    name: str
    scopes: list[str] = []
    expires_in_days: int | None = None
    publish_direct: bool = False
    purpose: str | None = None
    # SP3.3: explicit permissions subset to grant on this token.
    # If None (the default), the token inherits the issuer's role-default permissions.
    permissions: list[str] | None = None

    @field_validator("purpose")
    @classmethod
    def purpose_required_when_grant(cls, v: str | None, info) -> str | None:
        if info.data.get("publish_direct") and not (v and v.strip()):
            raise ValueError("purpose is required when publish_direct=true")
        return v


class APITokenResponse(BaseModel):
    id: uuid.UUID
    name: str
    scopes: list[str]
    expires_at: datetime | None
    publish_direct: bool
    purpose: str | None
    # SP3.3: explicit permission subset stored on this token (None = role defaults).
    permissions: list[str] | None
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateAPITokenResponse(APITokenResponse):
    """Extends APITokenResponse with the raw token — returned only at creation time."""

    raw_token: str


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    is_active: bool
    created_at: datetime
    # Permissions keyed by project slug — computed at /me time from role +
    # token grant (publish_direct). Additive: never subtractive.
    permissions_by_project: dict[str, list[str]] = {}

    model_config = {"from_attributes": True}
