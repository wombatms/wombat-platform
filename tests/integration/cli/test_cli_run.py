"""Integration tests for `wombat run {start,record,close}`.

All tests mock the HTTP layer with respx so no live API server is required.
The CliRunner invokes the real Typer commands end-to-end; only the httpx
transport is intercepted.
"""

from __future__ import annotations

import json
import textwrap
import uuid
from pathlib import Path

import pytest
import respx
from httpx import Response
from typer.testing import CliRunner

from wombat_cli.main import app

# ---------------------------------------------------------------------------
# Constants used across tests
# ---------------------------------------------------------------------------

API_BASE = "http://wombat-test.local"
PROJECT = "demo"
TOKEN = "test-token-abc"
RUN_ID = str(uuid.uuid4())
CASE_ID = "TC-001"
ENV_ID = str(uuid.uuid4())

HEADERS = {"Authorization": f"Bearer {TOKEN}"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def runner() -> CliRunner:
    return CliRunner()


def _run_detail(
    run_id: str = RUN_ID,
    title: str = "smoke",
    status: str = "open",
) -> dict:
    """Build a minimal RunDetailOut dict."""
    return {
        "id": run_id,
        "title": title,
        "status": status,
        "environment_id": None,
        "environment_name": None,
        "owner_id": str(uuid.uuid4()),
        "created_at": "2026-04-22T10:00:00Z",
        "updated_at": "2026-04-22T10:00:00Z",
        "started_at": None,
        "closed_at": None,
        "closure_note": None,
        "counts": {"total": 1, "pass": 0, "fail": 0, "blocked": 0, "skipped": 0, "not_run": 1},
        "source": "manual",
        "parent_run_id": None,
        "assignees": [],
    }


# ---------------------------------------------------------------------------
# wombat run start — happy path
# ---------------------------------------------------------------------------


@respx.mock
def test_run_start_happy_path(runner: CliRunner):
    """start --cases posts to /runs and prints the run JSON to stdout."""
    detail = _run_detail(run_id=RUN_ID, title="smoke")

    respx.post(f"{API_BASE}/api/projects/{PROJECT}/runs").mock(
        return_value=Response(201, json={"data": detail})
    )

    result = runner.invoke(
        app,
        [
            "run", "start",
            "--project", PROJECT,
            "--title", "smoke",
            "--cases", CASE_ID,
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    assert result.exit_code == 0, result.output
    payload = json.loads(result.output)
    assert payload["id"] == RUN_ID
    assert payload["title"] == "smoke"
    assert payload["status"] == "open"


@respx.mock
def test_run_start_with_env(runner: CliRunner):
    """start --env resolves environment name to UUID before posting the run."""
    env_list = [{"id": ENV_ID, "name": "staging", "created_at": "2026-04-22T00:00:00Z"}]
    detail = _run_detail(run_id=RUN_ID, title="with-env")

    respx.get(f"{API_BASE}/api/projects/{PROJECT}/environments").mock(
        return_value=Response(200, json={"data": env_list})
    )
    run_route = respx.post(f"{API_BASE}/api/projects/{PROJECT}/runs").mock(
        return_value=Response(201, json={"data": detail})
    )

    result = runner.invoke(
        app,
        [
            "run", "start",
            "--project", PROJECT,
            "--title", "with-env",
            "--cases", CASE_ID,
            "--env", "staging",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    assert result.exit_code == 0, result.output
    # Verify the environment_id was included in the request body
    sent = json.loads(run_route.calls[0].request.content)
    assert sent["environment_id"] == ENV_ID


@respx.mock
def test_run_start_env_not_found(runner: CliRunner):
    """start --env exits with code 1 when the env name doesn't exist in the project."""
    respx.get(f"{API_BASE}/api/projects/{PROJECT}/environments").mock(
        return_value=Response(200, json={"data": []})
    )

    result = runner.invoke(
        app,
        [
            "run", "start",
            "--project", PROJECT,
            "--title", "bad-env",
            "--cases", CASE_ID,
            "--env", "nonexistent",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    assert result.exit_code == 1
    assert "nonexistent" in result.output or "nonexistent" in (result.stderr or "")


@respx.mock
def test_run_start_with_filter_query(runner: CliRunner):
    """start --filter-query sends the filter dict in case_selection."""
    detail = _run_detail(run_id=RUN_ID, title="filter-run")
    run_route = respx.post(f"{API_BASE}/api/projects/{PROJECT}/runs").mock(
        return_value=Response(201, json={"data": detail})
    )

    filter_json = json.dumps({"tags": ["smoke"]})
    result = runner.invoke(
        app,
        [
            "run", "start",
            "--project", PROJECT,
            "--title", "filter-run",
            "--filter-query", filter_json,
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    assert result.exit_code == 0, result.output
    sent = json.loads(run_route.calls[0].request.content)
    assert sent["case_selection"] == {"filter": {"tags": ["smoke"]}}


def test_run_start_cases_and_filter_mutually_exclusive(runner: CliRunner):
    """start fails when both --cases and --filter-query are given."""
    result = runner.invoke(
        app,
        [
            "run", "start",
            "--project", PROJECT,
            "--title", "bad",
            "--cases", CASE_ID,
            "--filter-query", '{"tags": ["x"]}',
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )
    assert result.exit_code == 1


def test_run_start_neither_cases_nor_filter(runner: CliRunner):
    """start fails when neither --cases nor --filter-query is given."""
    result = runner.invoke(
        app,
        [
            "run", "start",
            "--project", PROJECT,
            "--title", "bad",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )
    assert result.exit_code == 1


def test_run_start_cases_from_file(runner: CliRunner, tmp_path: Path):
    """start --cases @file.txt reads one ID per line."""
    cases_file = tmp_path / "cases.txt"
    cases_file.write_text("TC-001\nTC-002\nTC-003\n")

    with respx.mock:
        detail = _run_detail(run_id=RUN_ID, title="from-file")
        route = respx.post(f"{API_BASE}/api/projects/{PROJECT}/runs").mock(
            return_value=Response(201, json={"data": detail})
        )

        result = runner.invoke(
            app,
            [
                "run", "start",
                "--project", PROJECT,
                "--title", "from-file",
                "--cases", f"@{cases_file}",
                "--server", API_BASE,
                "--token", TOKEN,
            ],
        )

    assert result.exit_code == 0, result.output
    sent = json.loads(route.calls[0].request.content)
    assert sent["case_selection"]["case_ids"] == ["TC-001", "TC-002", "TC-003"]


def test_run_start_missing_server(runner: CliRunner):
    """start exits 1 when --server is not given and WOMBAT_API_URL is unset."""
    import os
    env = {k: v for k, v in os.environ.items() if k != "WOMBAT_API_URL"}

    result = runner.invoke(
        app,
        [
            "run", "start",
            "--project", PROJECT,
            "--title", "smoke",
            "--cases", CASE_ID,
        ],
        env=env,
        catch_exceptions=False,
    )
    assert result.exit_code == 1


# ---------------------------------------------------------------------------
# wombat run record — happy path
# ---------------------------------------------------------------------------


@respx.mock
def test_run_record_pass(runner: CliRunner):
    """record -s p posts a batch with status=pass and prints the first result."""
    batch_response = {
        "results": [{"case_id": CASE_ID, "ok": True, "revision": 1, "error": None}]
    }
    respx.post(
        f"{API_BASE}/api/projects/{PROJECT}/runs/{RUN_ID}/results"
    ).mock(return_value=Response(200, json=batch_response))

    result = runner.invoke(
        app,
        [
            "run", "record",
            "--project", PROJECT,
            "--run", RUN_ID,
            "--case", CASE_ID,
            "--status", "p",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    assert result.exit_code == 0, result.output
    out = json.loads(result.output)
    assert out["case_id"] == CASE_ID
    assert out["ok"] is True
    assert out["revision"] == 1


@respx.mock
def test_run_record_fail_with_options(runner: CliRunner):
    """record -s f with --failed-at-step and --bug sends correct payload."""
    batch_response = {
        "results": [{"case_id": CASE_ID, "ok": True, "revision": 1, "error": None}]
    }
    route = respx.post(
        f"{API_BASE}/api/projects/{PROJECT}/runs/{RUN_ID}/results"
    ).mock(return_value=Response(200, json=batch_response))

    result = runner.invoke(
        app,
        [
            "run", "record",
            "--project", PROJECT,
            "--run", RUN_ID,
            "--case", CASE_ID,
            "--status", "fail",
            "--note", "Step 3 failed",
            "--failed-at-step", "3",
            "--bug", "https://jira.example.com/PROJ-42",
            "--duration-ms", "1500",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    assert result.exit_code == 0, result.output
    sent_items = json.loads(route.calls[0].request.content)
    assert len(sent_items) == 1
    item = sent_items[0]
    assert item["status"] == "fail"
    assert item["notes"] == "Step 3 failed"
    assert item["failed_at_step"] == 3
    assert item["bug_links"] == [{"url": "https://jira.example.com/PROJ-42"}]
    assert item["duration_ms"] == 1500


@respx.mock
def test_run_record_blocked(runner: CliRunner):
    """record -s b maps to blocked."""
    batch_response = {
        "results": [{"case_id": CASE_ID, "ok": True, "revision": 1, "error": None}]
    }
    route = respx.post(
        f"{API_BASE}/api/projects/{PROJECT}/runs/{RUN_ID}/results"
    ).mock(return_value=Response(200, json=batch_response))

    runner.invoke(
        app,
        [
            "run", "record",
            "--project", PROJECT,
            "--run", RUN_ID,
            "--case", CASE_ID,
            "-s", "b",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    sent_items = json.loads(route.calls[0].request.content)
    assert sent_items[0]["status"] == "blocked"


@respx.mock
def test_run_record_skipped(runner: CliRunner):
    """record -s s maps to skipped."""
    batch_response = {
        "results": [{"case_id": CASE_ID, "ok": True, "revision": 1, "error": None}]
    }
    route = respx.post(
        f"{API_BASE}/api/projects/{PROJECT}/runs/{RUN_ID}/results"
    ).mock(return_value=Response(200, json=batch_response))

    runner.invoke(
        app,
        [
            "run", "record",
            "--project", PROJECT,
            "--run", RUN_ID,
            "--case", CASE_ID,
            "-s", "s",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    sent_items = json.loads(route.calls[0].request.content)
    assert sent_items[0]["status"] == "skipped"


@respx.mock
def test_run_record_with_if_match(runner: CliRunner):
    """record --if-match N includes if_match_revision in the payload."""
    batch_response = {
        "results": [{"case_id": CASE_ID, "ok": True, "revision": 2, "error": None}]
    }
    route = respx.post(
        f"{API_BASE}/api/projects/{PROJECT}/runs/{RUN_ID}/results"
    ).mock(return_value=Response(200, json=batch_response))

    result = runner.invoke(
        app,
        [
            "run", "record",
            "--project", PROJECT,
            "--run", RUN_ID,
            "--case", CASE_ID,
            "-s", "pass",
            "--if-match", "1",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    assert result.exit_code == 0, result.output
    sent_items = json.loads(route.calls[0].request.content)
    assert sent_items[0]["if_match_revision"] == 1


def test_run_record_invalid_status(runner: CliRunner):
    """record exits 1 for an unknown status flag."""
    result = runner.invoke(
        app,
        [
            "run", "record",
            "--project", PROJECT,
            "--run", RUN_ID,
            "--case", CASE_ID,
            "--status", "x",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )
    assert result.exit_code == 1


# ---------------------------------------------------------------------------
# wombat run close — happy path
# ---------------------------------------------------------------------------


@respx.mock
def test_run_close_completed(runner: CliRunner):
    """close --reason completed posts the close endpoint and prints RunDetail."""
    detail = _run_detail(run_id=RUN_ID, title="smoke", status="completed")

    route = respx.post(
        f"{API_BASE}/api/projects/{PROJECT}/runs/{RUN_ID}/close"
    ).mock(return_value=Response(200, json={"data": detail}))

    result = runner.invoke(
        app,
        [
            "run", "close",
            "--project", PROJECT,
            "--run", RUN_ID,
            "--reason", "completed",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    assert result.exit_code == 0, result.output
    out = json.loads(result.output)
    assert out["id"] == RUN_ID
    assert out["status"] == "completed"

    sent = json.loads(route.calls[0].request.content)
    assert sent["reason"] == "completed"
    assert "note" not in sent


@respx.mock
def test_run_close_aborted_with_note(runner: CliRunner):
    """close --reason aborted --note includes the note in the payload."""
    detail = _run_detail(run_id=RUN_ID, title="smoke", status="aborted")

    route = respx.post(
        f"{API_BASE}/api/projects/{PROJECT}/runs/{RUN_ID}/close"
    ).mock(return_value=Response(200, json={"data": detail}))

    result = runner.invoke(
        app,
        [
            "run", "close",
            "--project", PROJECT,
            "--run", RUN_ID,
            "--reason", "aborted",
            "--note", "Infrastructure outage",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    assert result.exit_code == 0, result.output
    sent = json.loads(route.calls[0].request.content)
    assert sent["reason"] == "aborted"
    assert sent["note"] == "Infrastructure outage"


def test_run_close_invalid_reason(runner: CliRunner):
    """close exits 1 for an unknown reason."""
    result = runner.invoke(
        app,
        [
            "run", "close",
            "--project", PROJECT,
            "--run", RUN_ID,
            "--reason", "cancelled",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )
    assert result.exit_code == 1


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


@respx.mock
def test_run_start_api_error_surfaces(runner: CliRunner):
    """4xx API errors are printed and exit code is 1."""
    respx.post(f"{API_BASE}/api/projects/{PROJECT}/runs").mock(
        return_value=Response(
            403,
            json={"error": {"code": "permission_denied", "message": "Not authorized", "hint": None}},
        )
    )

    result = runner.invoke(
        app,
        [
            "run", "start",
            "--project", PROJECT,
            "--title", "smoke",
            "--cases", CASE_ID,
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    assert result.exit_code == 1
    # Error output should reference the error code or message
    combined = result.output + (result.stderr or "")
    assert "403" in combined or "permission_denied" in combined or "Not authorized" in combined


@respx.mock
def test_run_close_api_error_409(runner: CliRunner):
    """409 conflict from close is surfaced with exit code 1."""
    respx.post(
        f"{API_BASE}/api/projects/{PROJECT}/runs/{RUN_ID}/close"
    ).mock(
        return_value=Response(
            409,
            json={"error": {"code": "run_closed", "message": "Run is already closed."}},
        )
    )

    result = runner.invoke(
        app,
        [
            "run", "close",
            "--project", PROJECT,
            "--run", RUN_ID,
            "--reason", "completed",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )

    assert result.exit_code == 1


# ---------------------------------------------------------------------------
# Full lifecycle: start -> record -> close
# ---------------------------------------------------------------------------


@respx.mock
def test_run_start_record_close_lifecycle(runner: CliRunner):
    """Full lifecycle: start a run, record a result, then close it."""
    detail_open = _run_detail(run_id=RUN_ID, title="lifecycle", status="open")
    detail_closed = _run_detail(run_id=RUN_ID, title="lifecycle", status="completed")
    batch_response = {
        "results": [{"case_id": CASE_ID, "ok": True, "revision": 1, "error": None}]
    }

    respx.post(f"{API_BASE}/api/projects/{PROJECT}/runs").mock(
        return_value=Response(201, json={"data": detail_open})
    )
    respx.post(
        f"{API_BASE}/api/projects/{PROJECT}/runs/{RUN_ID}/results"
    ).mock(return_value=Response(200, json=batch_response))
    respx.post(
        f"{API_BASE}/api/projects/{PROJECT}/runs/{RUN_ID}/close"
    ).mock(return_value=Response(200, json={"data": detail_closed}))

    # start
    r1 = runner.invoke(
        app,
        [
            "run", "start",
            "--project", PROJECT,
            "--title", "lifecycle",
            "--cases", CASE_ID,
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )
    assert r1.exit_code == 0, r1.output
    run_data = json.loads(r1.output)
    assert run_data["id"] == RUN_ID

    # record
    r2 = runner.invoke(
        app,
        [
            "run", "record",
            "--project", PROJECT,
            "--run", RUN_ID,
            "--case", CASE_ID,
            "-s", "p",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )
    assert r2.exit_code == 0, r2.output
    rec = json.loads(r2.output)
    assert rec["ok"] is True

    # close
    r3 = runner.invoke(
        app,
        [
            "run", "close",
            "--project", PROJECT,
            "--run", RUN_ID,
            "--reason", "completed",
            "--server", API_BASE,
            "--token", TOKEN,
        ],
    )
    assert r3.exit_code == 0, r3.output
    closed = json.loads(r3.output)
    assert closed["status"] == "completed"
