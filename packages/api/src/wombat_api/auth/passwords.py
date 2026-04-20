"""Password hashing and verification using bcrypt."""

from __future__ import annotations

import bcrypt


def hash_password(pw: str) -> str:
    """Return a bcrypt hash of the plaintext password."""
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    """Return True if the plaintext password matches the stored hash."""
    return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
