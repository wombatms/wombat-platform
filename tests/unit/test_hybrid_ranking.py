"""Unit tests for the hybrid blend helper in wombat_api.search.hybrid.

These tests are pure Python — no Postgres required.

The blend() function was extracted from the inlined Postgres weight expression
(``w_cos * cos_score + w_bm * bm25_score``) to allow independent testing of the
scoring arithmetic.

Weights: cosine 0.7, BM25 0.3 (W_COS / W_BM25 constants in hybrid.py).
"""

from __future__ import annotations

import math

from wombat_api.search.hybrid import W_BM25, W_COS, blend

# ---------------------------------------------------------------------------
# Basic arithmetic
# ---------------------------------------------------------------------------


def test_blend_default_weights_match_constants():
    """blend() with default args must use W_COS and W_BM25."""
    cos, bm25 = 0.8, 0.5
    expected = W_COS * cos + W_BM25 * bm25
    assert math.isclose(blend(cos, bm25), expected)


def test_blend_explicit_weights():
    """Custom weights must override the defaults."""
    result = blend(cos=0.6, bm25=0.4, w_cos=0.5, w_bm25=0.5)
    assert math.isclose(result, 0.5 * 0.6 + 0.5 * 0.4)


def test_blend_zero_bm25():
    """With w_bm25=0 (semantic-only mode), the score is purely cosine."""
    cos = 0.9
    result = blend(cos, bm25=0.99, w_cos=W_COS, w_bm25=0.0)
    assert math.isclose(result, W_COS * cos)


def test_blend_zero_cos():
    """With w_cos=0 (keyword-only mode), the score is purely BM25."""
    bm25 = 0.7
    result = blend(cos=0.99, bm25=bm25, w_cos=0.0, w_bm25=W_BM25)
    assert math.isclose(result, W_BM25 * bm25)


def test_blend_perfect_scores():
    """Max cosine (1.0) and max BM25 (1.0) with unit weights → 1.0."""
    result = blend(1.0, 1.0, w_cos=0.5, w_bm25=0.5)
    assert math.isclose(result, 1.0)


def test_blend_zero_scores():
    """Zero cosine and zero BM25 → 0.0."""
    assert blend(0.0, 0.0) == 0.0


# ---------------------------------------------------------------------------
# Ordering invariants
# ---------------------------------------------------------------------------


def test_blend_ordering_preserved_under_monotonic_scaling():
    """If A ranks above B by cosine, scaling both equally must preserve the order.

    This mirrors the real-world requirement that a batch of results sorted by
    blended score remains in the same order regardless of whether cos/bm25
    values are raw floats or proportionally scaled.
    """
    # Doc A: higher cosine, lower BM25
    # Doc B: lower cosine, higher BM25
    # With default 0.7/0.3 weights, A should win.
    score_a = blend(cos=0.9, bm25=0.2)
    score_b = blend(cos=0.4, bm25=0.8)
    assert score_a > score_b

    # Multiply both inputs by 0.5 — ranking must be preserved.
    score_a_scaled = blend(cos=0.45, bm25=0.1)
    score_b_scaled = blend(cos=0.2, bm25=0.4)
    assert score_a_scaled > score_b_scaled


def test_blend_ranking_for_equal_cos_different_bm25():
    """When cosine is equal, the BM25 term breaks the tie."""
    high_bm25 = blend(cos=0.5, bm25=0.8)
    low_bm25 = blend(cos=0.5, bm25=0.1)
    assert high_bm25 > low_bm25


def test_blend_ranking_for_equal_bm25_different_cos():
    """When BM25 is equal, the cosine term breaks the tie."""
    high_cos = blend(cos=0.9, bm25=0.5)
    low_cos = blend(cos=0.2, bm25=0.5)
    assert high_cos > low_cos


# ---------------------------------------------------------------------------
# Tie-break determinism
# ---------------------------------------------------------------------------


def test_blend_is_deterministic():
    """Same inputs always produce the same float output."""
    inputs = [(0.7, 0.4), (0.3, 0.9), (0.0, 0.0), (1.0, 1.0)]
    for cos, bm25 in inputs:
        r1 = blend(cos, bm25)
        r2 = blend(cos, bm25)
        assert r1 == r2, f"Non-deterministic result for cos={cos}, bm25={bm25}"


def test_blend_returns_float():
    """blend() must always return a float, not an int."""
    result = blend(1, 1)  # integer inputs
    assert isinstance(result, float)


# ---------------------------------------------------------------------------
# Weight constants
# ---------------------------------------------------------------------------


def test_weight_constants_sum_to_one():
    """Default weights must sum to 1.0 so scores stay in [0, 1] for valid inputs."""
    assert math.isclose(W_COS + W_BM25, 1.0)


def test_default_cos_weight_is_dominant():
    """Cosine weight must be >= BM25 weight (semantic retrieval takes priority)."""
    assert W_COS >= W_BM25
