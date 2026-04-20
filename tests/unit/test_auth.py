"""Tests for JWT auth and password hashing."""

import pytest
import uuid
from datetime import datetime, timezone, timedelta

from wombat_api.auth.jwt import create_access_token, create_refresh_token, decode_token
from wombat_api.auth.passwords import hash_password, verify_password


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
