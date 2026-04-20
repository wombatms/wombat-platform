"""Pin the invariants of canonical_json + content_hash_for.

These tests document and enforce the current behaviour of the canonicalization
implementation (json.dumps with sort_keys=True).  If the implementation ever
changes, these tests will fail and the author must update them with a clear
rationale comment explaining what changed and why.

Implementation under test:
    wombat_api.database.repository.canonical_json
    wombat_api.database.repository.content_hash_for
"""

from __future__ import annotations

import unicodedata

import pytest

from wombat_api.database.repository import canonical_json, content_hash_for


# ---------------------------------------------------------------------------
# canonical_json invariants
# ---------------------------------------------------------------------------


def test_key_reordering_produces_same_json():
    """Key ordering must not affect the canonical representation.

    json.dumps with sort_keys=True sorts all keys lexicographically so
    {'b': 2, 'a': 1} and {'a': 1, 'b': 2} produce identical output.
    """
    j1 = canonical_json({"a": 1, "b": 2})
    j2 = canonical_json({"b": 2, "a": 1})
    assert j1 == j2


def test_nested_key_reordering_produces_same_json():
    """Nested key ordering must also be normalized."""
    j1 = canonical_json({"x": {"a": 1, "b": 2}})
    j2 = canonical_json({"x": {"b": 2, "a": 1}})
    assert j1 == j2


def test_whitespace_in_string_values_affects_json():
    """Trailing whitespace in string values changes the canonical representation.

    This is intentional: whitespace within body text is semantically meaningful
    and must not be silently normalized.
    """
    j1 = canonical_json({"k": "foo"})
    j2 = canonical_json({"k": "foo "})  # trailing space
    assert j1 != j2


def test_list_order_affects_json():
    """List order is semantic — [1, 2] vs [2, 1] produce different JSON."""
    j1 = canonical_json({"items": [1, 2]})
    j2 = canonical_json({"items": [2, 1]})
    assert j1 != j2


def test_none_vs_missing_key_affects_json():
    """An explicit None value is distinct from an absent key."""
    j1 = canonical_json({"a": None})
    j2 = canonical_json({})
    assert j1 != j2


# ---------------------------------------------------------------------------
# content_hash_for invariants
# ---------------------------------------------------------------------------


def test_key_reordering_produces_same_hash():
    """Hash must be identical regardless of input key order."""
    h1 = content_hash_for({"a": 1, "b": 2})
    h2 = content_hash_for({"b": 2, "a": 1})
    assert h1 == h2


def test_nested_key_reordering_produces_same_hash():
    h1 = content_hash_for({"outer": {"z": 0, "a": 1}})
    h2 = content_hash_for({"outer": {"a": 1, "z": 0}})
    assert h1 == h2


def test_whitespace_in_values_produces_different_hash():
    h1 = content_hash_for({"body": "hello"})
    h2 = content_hash_for({"body": "hello "})
    assert h1 != h2


def test_numeric_policy_int_vs_float():
    """Policy: int 1 and float 1.0 are serialized differently by json.dumps.

    json.dumps({"n": 1}) → '{"n": 1}'
    json.dumps({"n": 1.0}) → '{"n": 1.0}'

    These produce DIFFERENT hashes under the current implementation.  This is
    the expected invariant.  If canonicalization is ever changed to normalize
    numeric types (e.g., always serialize as float), update this test with the
    rationale.
    """
    h_int = content_hash_for({"n": 1})
    h_float = content_hash_for({"n": 1.0})
    # Document the current behaviour: different types → different hashes.
    assert h_int != h_float, (
        "int 1 and float 1.0 serialize differently under json.dumps; "
        "if this assertion fails, canonicalization has changed — update with rationale."
    )


def test_list_order_produces_different_hash():
    h1 = content_hash_for({"steps": [1, 2, 3]})
    h2 = content_hash_for({"steps": [3, 2, 1]})
    assert h1 != h2


def test_none_vs_missing_key_produces_different_hash():
    h1 = content_hash_for({"result": None})
    h2 = content_hash_for({})
    assert h1 != h2


def test_different_body_same_title_produces_different_hash():
    h1 = content_hash_for({"title": "T", "body": "A"})
    h2 = content_hash_for({"title": "T", "body": "B"})
    assert h1 != h2


def test_hash_is_stable_across_calls():
    """The same input always produces the same hash (no randomness)."""
    body = {"id": "TC-001", "title": "Login test", "steps": [1, 2, 3]}
    assert content_hash_for(body) == content_hash_for(body)


def test_hash_output_is_64_hex_chars():
    """SHA-256 produces a 32-byte (64 hex-character) digest."""
    h = content_hash_for({"x": 1})
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)


def test_unicode_nfc_vs_nfd_policy():
    """Policy: NFC é (U+00E9) and NFD é (U+0065 + U+0301) produce DIFFERENT hashes.

    The current implementation does NOT normalize Unicode before serialization.
    json.dumps with ensure_ascii=False preserves the original code points, so
    the two forms produce different byte sequences → different hashes.

    If Unicode normalization is ever added (e.g., unicodedata.normalize('NFC', ...)),
    update this test with the rationale and note that content already indexed
    under the old scheme must be re-indexed.
    """
    nfc_char = "\u00e9"          # é as a single precomposed code point
    nfd_char = "\u0065\u0301"    # é as e + combining acute accent
    # Sanity: these are visually identical but distinct byte sequences.
    assert nfc_char != nfd_char
    assert unicodedata.normalize("NFC", nfd_char) == nfc_char

    h_nfc = content_hash_for({"t": nfc_char})
    h_nfd = content_hash_for({"t": nfd_char})
    assert h_nfc != h_nfd, (
        "NFC and NFD forms hash differently under the current implementation. "
        "If this fails, Unicode normalization was added — update this test "
        "and re-index all existing content."
    )
