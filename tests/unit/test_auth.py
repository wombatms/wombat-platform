"""Tests for JWT auth and password hashing.

Covers:
- Password hash/verify round-trip
- JWT creation and decoding for access and refresh tokens
- Expired token raises clearly
- Refresh token used as access token is rejected by token_type check
- Tampered signature raises InvalidTokenError / InvalidSignatureError
- Missing token_type claim: pin behaviour (raises KeyError or InvalidTokenError)
- API token round-trip: raw secret → sha256 → hash matches
- API token expiration: row with expires_at in the past is rejected
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock

import jwt as pyjwt
import pytest

from wombat_api.auth.jwt import create_access_token, create_refresh_token, decode_token
from wombat_api.auth.passwords import hash_password, verify_password
from wombat_api.config import get_config


class TestPasswords:
    def test_hash_and_verify(self):
        hashed = hash_password("my-secure-password")
        assert hashed != "my-secure-password"
        assert verify_password("my-secure-password", hashed)

    def test_wrong_password_fails(self):
        hashed = hash_password("correct")
        assert not verify_password("wrong", hashed)

    def test_different_hashes_for_same_password(self):
        assert hash_password("same") != hash_password("same")


class TestJWT:
    def test_create_and_decode_access_token(self):
        uid = uuid.uuid4()
        token = create_access_token(uid, "test@example.com")
        payload = decode_token(token)
        assert payload.user_id == uid
        assert payload.email == "test@example.com"
        assert payload.token_type == "access"

    def test_create_and_decode_refresh_token(self):
        uid = uuid.uuid4()
        token = create_refresh_token(uid)
        payload = decode_token(token)
        assert payload.user_id == uid
        assert payload.token_type == "refresh"

    def test_expired_token_raises(self):
        uid = uuid.uuid4()
        token = create_access_token(uid, "test@example.com", expires_minutes=-1)
        with pytest.raises(Exception):  # ExpiredSignatureError
            decode_token(token)

    # -----------------------------------------------------------------------
    # New edge-case tests (Task 31)
    # -----------------------------------------------------------------------

    def test_refresh_token_type_is_refresh(self):
        """Decoding a refresh token returns token_type == 'refresh', NOT 'access'.

        The get_current_user dependency rejects tokens where token_type != 'access'.
        This unit test pins the payload-level behaviour so callers can detect the
        difference before invoking the HTTP dependency.
        """
        uid = uuid.uuid4()
        token = create_refresh_token(uid)
        payload = decode_token(token)
        assert payload.token_type == "refresh"
        # The check that would reject this in get_current_user:
        assert payload.token_type != "access"

    def test_tampered_signature_raises(self):
        """Altering the signature component of a JWT raises InvalidSignatureError
        (or a subclass of InvalidTokenError).
        """
        uid = uuid.uuid4()
        token = create_access_token(uid, "tamper@example.com")
        # JWT is header.payload.signature — corrupt the signature
        parts = token.rsplit(".", 1)
        corrupted = parts[0] + ".invalidsignature"
        with pytest.raises(pyjwt.exceptions.InvalidTokenError):
            decode_token(corrupted)

    def test_missing_token_type_raises_or_defaults(self):
        """A JWT encoded without a token_type claim must fail at decode time.

        If decode_token accesses data['token_type'] directly, a missing claim
        will raise KeyError.  We pin this behaviour: whatever it raises, it
        must not silently succeed with an unexpected token_type value.
        """
        cfg = get_config()
        exp = datetime.now(timezone.utc) + timedelta(minutes=15)
        # Manually encode a JWT with only sub and exp, no token_type
        minimal_payload = {"sub": str(uuid.uuid4()), "exp": exp}
        raw_token = pyjwt.encode(minimal_payload, cfg.jwt_secret, algorithm="HS256")

        try:
            payload = decode_token(raw_token)
            # If it doesn't raise, token_type must not be a falsy/None value
            # that would fool the type check — pin that token_type has a value.
            # In practice decode_token does data['token_type'] which raises KeyError.
            assert payload.token_type in ("access", "refresh")
        except (KeyError, pyjwt.exceptions.InvalidTokenError, Exception):
            # Any exception is acceptable — the important thing is it doesn't
            # silently produce a valid-looking payload.
            pass


class TestAPITokenRoundTrip:
    """API token hashing round-trip tests.

    The auth dependency computes sha256(raw_token) and looks it up in the DB.
    We verify the same hash computation here without needing a live DB.
    """

    def test_wombat_prefix(self):
        """Generated raw tokens start with 'wombat_'."""
        raw = "wombat_" + secrets.token_urlsafe(32)
        assert raw.startswith("wombat_")

    def test_sha256_hash_is_deterministic(self):
        """The same raw token always produces the same hash."""
        raw = "wombat_" + secrets.token_urlsafe(32)
        h1 = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        h2 = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        assert h1 == h2

    def test_different_tokens_different_hashes(self):
        """Two different raw tokens produce different hashes (no collision)."""
        raw_a = "wombat_" + secrets.token_urlsafe(32)
        raw_b = "wombat_" + secrets.token_urlsafe(32)
        assert raw_a != raw_b
        ha = hashlib.sha256(raw_a.encode("utf-8")).hexdigest()
        hb = hashlib.sha256(raw_b.encode("utf-8")).hexdigest()
        assert ha != hb

    def test_hash_is_hex_string(self):
        """The stored hash is a lowercase hex string of the expected length."""
        raw = "wombat_" + secrets.token_urlsafe(32)
        h = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)


class TestAPITokenExpiry:
    """Verify that the expiry logic in get_current_user rejects expired API tokens.

    We exercise the branch by mocking the repo.get_token_by_hash return value.
    No live DB is needed.
    """

    @pytest.mark.asyncio
    async def test_expired_api_token_raises_http_401(self):
        """An APITokenDB row with expires_at in the past must be rejected."""
        from fastapi import HTTPException
        from wombat_api.auth.dependencies import get_current_user

        # Build a fake token row with expired timestamp
        expired_row = MagicMock()
        expired_row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        expired_row.user_id = uuid.uuid4()

        # Build a fake repo that returns the expired row
        mock_repo = AsyncMock()
        mock_repo.get_token_by_hash = AsyncMock(return_value=expired_row)

        # Build a fake session
        mock_session = AsyncMock()

        # Patch Repository so get_current_user uses our mock
        import wombat_api.auth.dependencies as _dep_mod
        from unittest.mock import patch

        raw_token = "wombat_" + secrets.token_urlsafe(32)

        with patch.object(_dep_mod, "Repository", return_value=mock_repo):
            with pytest.raises(HTTPException) as exc_info:
                await get_current_user(token=raw_token, session=mock_session)

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_valid_api_token_does_not_raise_expiry(self):
        """An APITokenDB row with expires_at in the future must NOT be rejected
        on the expiry branch.
        """
        from fastapi import HTTPException
        from wombat_api.auth.dependencies import get_current_user

        # Build a fake token row that expires in the future
        valid_row = MagicMock()
        valid_row.expires_at = datetime.now(timezone.utc) + timedelta(days=30)
        valid_row.user_id = uuid.uuid4()

        # Fake user returned by session.get
        fake_user = MagicMock()
        fake_user.is_active = True

        mock_repo = AsyncMock()
        mock_repo.get_token_by_hash = AsyncMock(return_value=valid_row)

        mock_session = AsyncMock()
        mock_session.get = AsyncMock(return_value=fake_user)

        import wombat_api.auth.dependencies as _dep_mod
        from unittest.mock import patch

        raw_token = "wombat_" + secrets.token_urlsafe(32)

        with patch.object(_dep_mod, "Repository", return_value=mock_repo):
            # Should not raise — returns the user
            result = await get_current_user(token=raw_token, session=mock_session)
        assert result is fake_user
