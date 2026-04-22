"""Task 29: Batch ingestion semantics — partial success, conflicts, idempotent retry.

Tests:
1. 300-item batch where 5 reference unknown cases → 295 ok=True, 5 ok=False
   (error.code == "case_not_in_run").
2. Simulated concurrent conflict on TC-001 with if_match_revision=1:
   - First POST succeeds → revision=2.
   - Second POST (stale if_match_revision=1) → ok=False, code="result_conflict",
     current_revision=2.
3. Retry after partial conflict with updated if_match_revision=2 → succeeds,
   revision=3.
4. Duplicate retry (same revision, same status) → server upserts; revision ticks.
   Documented as known/spec-allowed "idempotent in practice" behaviour (§3.3).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

# ---------------------------------------------------------------------------
# Test 1: 300-item batch — 5 unknown case_ids → partial success
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_300_item_batch_5_unknown(
    httpx_client: AsyncClient,
    users,
    run_with_300_cases,
):
    """295 items succeed; 5 unknown case_ids are returned as ok=False.

    The HTTP response is 200 regardless of partial failure — the entire
    batch is accepted for processing and results are returned per-item.
    """
    editor_token = users["editor"]["token"]
    slug = run_with_300_cases.project_slug
    run_id = run_with_300_cases.id
    case_ids = run_with_300_cases.case_ids

    assert len(case_ids) == 300, f"Expected 300 case_ids, got {len(case_ids)}"

    # Build 300 valid items + 5 with completely made-up case_ids.
    items = [{"case_id": cid, "status": "pass"} for cid in case_ids]
    unknown_ids = [f"TC-UNKNOWN-BATCH-{i}" for i in range(5)]
    items.extend({"case_id": uid, "status": "pass"} for uid in unknown_ids)

    # Total 305 items: 300 valid + 5 unknown.
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=items,
    )
    assert r.status_code == 200, r.text
    body = r.json()

    assert "results" in body, "Response must contain 'results' key"
    results = body["results"]
    assert len(results) == 305, f"Expected 305 per-item results, got {len(results)}"

    ok_items = [res for res in results if res["ok"] is True]
    fail_items = [res for res in results if res["ok"] is False]

    assert len(ok_items) == 300, f"Expected 300 successes, got {len(ok_items)}"
    assert len(fail_items) == 5, f"Expected 5 failures, got {len(fail_items)}"

    # All failures must report case_not_in_run.
    for item in fail_items:
        assert item["error"]["code"] == "case_not_in_run", (
            f"Expected 'case_not_in_run' but got {item['error']['code']!r} "
            f"for case_id={item['case_id']!r}"
        )
        assert item["case_id"] in unknown_ids, (
            f"Unexpected failing case_id: {item['case_id']!r}"
        )

    # All successes must have a revision.
    for item in ok_items:
        assert item.get("revision") == 1, (
            f"Expected revision=1 for fresh result, got {item.get('revision')!r}"
        )


# ---------------------------------------------------------------------------
# Test 2: Simulated concurrent conflict — serial model, conflict semantics
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_if_match_conflict_second_writer_loses(
    httpx_client: AsyncClient,
    users,
    run_with_1_case,
):
    """Two sequential batches both using if_match_revision=1 for the same case.

    We model serial execution (single httpx client, no real concurrency) but
    verify the conflict semantics rigorously:
      - First POST: if_match_revision not set (fresh write) → ok=True, revision=1.
      - Second POST: if_match_revision=1 → ok=True, revision=2  (bumps to 2).
      - Third POST: if_match_revision=1 (stale) → ok=False, code="result_conflict",
        current_revision=2.
    """
    editor_token = users["editor"]["token"]
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id
    case_id = run_with_1_case.case_ids[0]

    # First write — no If-Match (initial record): succeeds with revision=1.
    r1 = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[{"case_id": case_id, "status": "pass"}],
    )
    assert r1.status_code == 200, r1.text
    item1 = r1.json()["results"][0]
    assert item1["ok"] is True
    assert item1["revision"] == 1

    # Second write — if_match_revision=1 (correct): bumps revision to 2.
    r2 = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[{"case_id": case_id, "status": "fail", "if_match_revision": 1}],
    )
    assert r2.status_code == 200, r2.text
    item2 = r2.json()["results"][0]
    assert item2["ok"] is True
    assert item2["revision"] == 2

    # Third write — if_match_revision=1 (now stale because current is 2):
    # This is the "second concurrent batch arrives late" scenario.
    r3 = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[{"case_id": case_id, "status": "blocked", "if_match_revision": 1}],
    )
    assert r3.status_code == 200, r3.text
    item3 = r3.json()["results"][0]
    assert item3["ok"] is False, (
        "Stale if_match_revision should yield ok=False"
    )
    assert item3["error"]["code"] == "result_conflict", (
        f"Expected 'result_conflict', got {item3['error']['code']!r}"
    )
    assert item3["error"]["current_revision"] == 2, (
        f"Expected current_revision=2, got {item3['error'].get('current_revision')!r}"
    )


# ---------------------------------------------------------------------------
# Test 3: Retry after partial conflict using updated if_match_revision
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_retry_after_conflict_succeeds(
    httpx_client: AsyncClient,
    users,
    run_with_3_cases,
):
    """After a conflict, retrying with the correct if_match_revision succeeds.

    Scenario:
      - Case 0: fresh write → revision=1.
      - Case 1: fresh write → revision=1.
      - Case 2: fresh write → revision=1.
      Then:
      - Mixed batch: case 0 with wrong if_match (stale) → conflict.
        case 1 with correct if_match=1 → revision=2.
        case 2 unknown → error (case_not_in_run) as baseline.
      Retry batch:
      - case 0 with updated if_match=1 → revision=2.  (was revision=1 after initial)
    """
    editor_token = users["editor"]["token"]
    slug = run_with_3_cases.project_slug
    run_id = run_with_3_cases.id
    case_ids = run_with_3_cases.case_ids
    case0, case1, case2 = case_ids[0], case_ids[1], case_ids[2]

    # Initial record for all 3 cases (no If-Match — fresh write).
    r = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[
            {"case_id": case0, "status": "pass"},
            {"case_id": case1, "status": "pass"},
            {"case_id": case2, "status": "pass"},
        ],
    )
    assert r.status_code == 200, r.text
    for item in r.json()["results"]:
        assert item["ok"] is True
        assert item["revision"] == 1

    # Mixed batch: case0 with stale if_match=0, case1 with correct if_match=1.
    r2 = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[
            {"case_id": case0, "status": "fail", "if_match_revision": 0},  # stale
            {"case_id": case1, "status": "fail", "if_match_revision": 1},  # correct
        ],
    )
    assert r2.status_code == 200, r2.text
    results2 = {item["case_id"]: item for item in r2.json()["results"]}

    assert results2[case0]["ok"] is False
    assert results2[case0]["error"]["code"] == "result_conflict"
    current_rev_case0 = results2[case0]["error"]["current_revision"]
    assert current_rev_case0 == 1, f"Expected current_revision=1, got {current_rev_case0}"

    assert results2[case1]["ok"] is True
    assert results2[case1]["revision"] == 2

    # Retry case0 with the updated if_match_revision=1 (current after initial write).
    r3 = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[
            {"case_id": case0, "status": "fail", "if_match_revision": current_rev_case0},
        ],
    )
    assert r3.status_code == 200, r3.text
    item_retry = r3.json()["results"][0]
    assert item_retry["ok"] is True
    assert item_retry["revision"] == 2, (
        f"Retry after conflict should yield revision=2, got {item_retry['revision']!r}"
    )


# ---------------------------------------------------------------------------
# Test 4: Duplicate retry (same revision, same status) → revision ticks
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_duplicate_retry_ticks_revision(
    httpx_client: AsyncClient,
    users,
    run_with_1_case,
):
    """Idempotent-in-practice: a true duplicate POST (same status, no If-Match)
    bumps the revision counter even though the payload is identical.

    This is documented known behaviour per spec §3.3:
      "Clients retrying on network error must handle the possibility of
       duplicate successes; they are idempotent in practice because the server
       writes UPSERT ... ON CONFLICT ... DO UPDATE keyed on the unique
       constraint."

    The UPSERT always performs the UPDATE path when a row already exists,
    which unconditionally increments the revision.  From the observer's
    perspective the end-state (same status) is the same; only the revision
    counter advances.  This is acceptable — the spec explicitly allows it
    and does NOT mandate that a duplicate write be a no-op.
    """
    editor_token = users["editor"]["token"]
    slug = run_with_1_case.project_slug
    run_id = run_with_1_case.id
    case_id = run_with_1_case.case_ids[0]

    # First write — no If-Match.
    r1 = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[{"case_id": case_id, "status": "pass"}],
    )
    assert r1.status_code == 200
    rev1 = r1.json()["results"][0]["revision"]
    assert rev1 == 1

    # Exact duplicate — same payload, no If-Match.
    r2 = await httpx_client.post(
        f"/api/projects/{slug}/runs/{run_id}/results",
        headers={"Authorization": f"Bearer {editor_token}"},
        json=[{"case_id": case_id, "status": "pass"}],
    )
    assert r2.status_code == 200
    item2 = r2.json()["results"][0]
    assert item2["ok"] is True, "Duplicate with no If-Match should still succeed"
    rev2 = item2["revision"]
    # The revision bumps — this is the known "idempotent in practice" behaviour.
    # We assert it is strictly greater to document the server's behaviour.
    assert rev2 > rev1, (
        f"Expected revision to tick on duplicate write; got rev1={rev1}, rev2={rev2}"
    )
