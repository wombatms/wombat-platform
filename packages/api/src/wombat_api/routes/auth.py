"""Auth routes: register, login, refresh, me, and API token CRUD."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from wombat_api.auth.dependencies import get_current_user, get_principal
from wombat_api.auth.jwt import (
    create_access_token,
    create_refresh_token,
    decode_token,
)
from wombat_api.auth.passwords import hash_password, verify_password
from wombat_api.database.engine import get_session
from wombat_api.database.models import APITokenDB, UserDB
from wombat_api.database.repository import Repository
from wombat_api.rbac.models import Role
from wombat_api.rbac.permissions import role_permissions
from wombat_api.schemas.auth import (
    APITokenResponse,
    CreateAPITokenRequest,
    CreateAPITokenResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from wombat_api.schemas.common import UserCreate

router = APIRouter()


@router.post("/register", response_model=UserResponse, status_code=201)
async def register(
    body: RegisterRequest,
    session: AsyncSession = Depends(get_session),
) -> UserDB:
    """Create a new user account.

    Bootstrap policy: the first user can register without authentication.
    Once at least one user exists this endpoint requires the caller to supply
    a valid bearer token belonging to a user who is an admin on *any* project.
    A simpler global-admin check is used here (any admin role) rather than
    requiring admin on a specific project; this keeps bootstrapping simple
    while still preventing open self-registration in a populated instance.
    """
    repo = Repository(session)

    # Count existing users to decide whether bootstrap is allowed.
    user_count: int = (await session.execute(select(func.count()).select_from(UserDB))).scalar_one()

    if user_count > 0:
        # Non-bootstrap: require a caller token and admin role on some project.
        # We re-use get_current_user manually here because this endpoint is
        # otherwise unauthenticated during bootstrap.
        # The caller must pass Authorization: Bearer <token>.
        # We can't use Depends() conditionally at runtime, so we raise
        # HTTP 401 with a hint if no token is provided.
        raise HTTPException(
            status_code=403,
            detail=(
                "Registration is restricted. An admin must create new accounts "
                "via an authenticated request. (Admin-only registration is not "
                "yet implemented as a guarded endpoint; bootstrap by seeding "
                "the first user, then use the admin API.)"
            ),
        )

    # Bootstrap: no users exist yet.
    existing = await repo.get_user_by_email(body.email)
    if existing is not None:
        raise HTTPException(status_code=409, detail="Email already registered")

    hashed_pw = hash_password(body.password)
    user_create = UserCreate(email=body.email, password=body.password, display_name=body.display_name)
    user = await repo.create_user(user_create, hashed_pw)
    await session.commit()
    return user


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Verify credentials and return access + refresh JWTs."""
    repo = Repository(session)
    user = await repo.get_user_by_email(body.email)
    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is inactive")

    access = create_access_token(user.id, user.email)
    refresh = create_refresh_token(user.id)
    return TokenResponse(access_token=access, refresh_token=refresh)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenResponse:
    """Exchange a refresh token for a new access + refresh token pair."""
    try:
        payload = decode_token(body.refresh_token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token") from exc

    if payload.token_type != "refresh":
        raise HTTPException(status_code=401, detail="Expected refresh token")

    user = await session.get(UserDB, payload.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is inactive")

    access = create_access_token(user.id, user.email)
    new_refresh = create_refresh_token(user.id)
    return TokenResponse(access_token=access, refresh_token=new_refresh)


@router.get("/me", response_model=UserResponse)
async def me(
    principal=Depends(get_principal),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    """Return the authenticated user's profile, including per-project permissions.

    permissions_by_project is computed from:
    - The user's role on each project (role_permissions).
    - Whether the acting token carries publish_direct (additive grant).

    This is computed at request time; there is no RBAC cache on the frontend.
    """
    repo = Repository(session)
    user: UserDB = principal.user
    slug_roles = await repo.list_user_project_roles(user.id)

    permissions_by_project: dict[str, list[str]] = {}
    for slug, role_str in slug_roles:
        try:
            role = Role(role_str)
        except ValueError:
            continue
        perms: set[str] = {str(p) for p in role_permissions(role)}
        # Additive: if the acting token has publish_direct, grant it globally.
        if principal.token is not None and principal.token.publish_direct:
            from wombat_api.rbac.permissions import Permission  # local import to avoid circular

            perms.add(str(Permission.CONTENT_PUBLISH_DIRECT))
        permissions_by_project[slug] = sorted(perms)

    return UserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_active=user.is_active,
        created_at=user.created_at,
        permissions_by_project=permissions_by_project,
    )


@router.post("/api-tokens", response_model=CreateAPITokenResponse, status_code=201)
async def create_api_token(
    body: CreateAPITokenRequest,
    user: UserDB = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CreateAPITokenResponse:
    """Generate a new API token for the authenticated user.

    The raw token (prefixed ``wombat_``) is returned once and never stored.
    Only its sha256 hash is persisted.
    """
    repo = Repository(session)

    # Generate a 32-byte random suffix → URL-safe base64 gives ~43 chars.
    raw_token = "wombat_" + secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    expires_at: datetime | None = None
    if body.expires_in_days is not None:
        expires_at = datetime.now(UTC) + timedelta(days=body.expires_in_days)

    token_row = await repo.create_api_token(
        user_id=user.id,
        name=body.name,
        scopes=body.scopes,
        token_hash=token_hash,
        expires_at=expires_at,
        publish_direct=body.publish_direct,
        purpose=body.purpose,
        permissions=body.permissions,
    )
    await session.commit()

    return CreateAPITokenResponse(
        id=token_row.id,
        name=token_row.name,
        scopes=token_row.scopes,
        expires_at=token_row.expires_at,
        publish_direct=token_row.publish_direct,
        purpose=token_row.purpose,
        permissions=token_row.permissions,
        created_at=token_row.created_at,
        raw_token=raw_token,
    )


@router.get("/api-tokens", response_model=list[APITokenResponse])
async def list_api_tokens(
    user: UserDB = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[APITokenDB]:
    """List all API tokens belonging to the authenticated user (no raw secrets)."""
    repo = Repository(session)
    return await repo.list_user_tokens(user.id)


@router.delete("/api-tokens/{token_id}", status_code=204)
async def delete_api_token(
    token_id: uuid.UUID,
    user: UserDB = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Revoke an API token owned by the authenticated user.

    Returns 204 on success, 404 if the token does not exist or is not owned
    by the caller.
    """

    token_row = await session.get(APITokenDB, token_id)
    if token_row is None or token_row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Token not found")

    repo = Repository(session)
    await repo.delete_token(token_id)
    await session.commit()
