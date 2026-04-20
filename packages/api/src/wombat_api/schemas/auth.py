"""Auth request/response schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


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


class APITokenResponse(BaseModel):
    id: uuid.UUID
    name: str
    scopes: list[str]
    expires_at: datetime | None
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

    model_config = {"from_attributes": True}
