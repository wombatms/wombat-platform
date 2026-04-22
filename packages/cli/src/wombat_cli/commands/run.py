"""wombat run — run lifecycle subcommands.

Provides:
  wombat run start  --project P --title T [--env E] --cases ID,ID,...
  wombat run record --project P --run R --case C --status {p|f|b|s} [options]
  wombat run close  --project P --run R --reason {completed|aborted} [--note N]
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

app = typer.Typer(
    name="run",
    help="Manage test runs: start, record results, and close.",
    no_args_is_help=True,
)

# ---------------------------------------------------------------------------
# Short status flag mapping
# ---------------------------------------------------------------------------

_STATUS_MAP: dict[str, str] = {
    "p": "pass",
    "f": "fail",
    "b": "blocked",
    "s": "skipped",
    "pass": "pass",
    "fail": "fail",
    "blocked": "blocked",
    "skipped": "skipped",
}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _make_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _http_error(exc) -> None:  # type: ignore[no-untyped-def]
    """Print a formatted error from an httpx HTTPStatusError and exit."""
    try:
        body = exc.response.json()
        err = body.get("error") or body
        code = err.get("code", "")
        msg = err.get("message", exc.response.text)
        hint = err.get("hint", "")
        parts = [f"HTTP {exc.response.status_code}"]
        if code:
            parts.append(f"[{code}]")
        parts.append(msg)
        if hint:
            parts.append(f"({hint})")
        typer.echo("Error: " + " — ".join(parts), err=True)
    except Exception:
        typer.echo(f"Error: HTTP {exc.response.status_code} — {exc.response.text}", err=True)
    raise typer.Exit(1) from None


def _request_error(exc) -> None:  # type: ignore[no-untyped-def]
    typer.echo(f"Error: request failed — {exc}", err=True)
    raise typer.Exit(1) from None


def _resolve_cases(cases_raw: str) -> list[str]:
    """Expand a comma-separated list or @file reference to individual case IDs."""
    if cases_raw.startswith("@"):
        path = Path(cases_raw[1:])
        if not path.exists():
            typer.echo(f"Error: cases file not found: {path}", err=True)
            raise typer.Exit(1)
        return [line.strip() for line in path.read_text().splitlines() if line.strip()]
    return [c.strip() for c in cases_raw.split(",") if c.strip()]


# ---------------------------------------------------------------------------
# wombat run start
# ---------------------------------------------------------------------------


@app.command("start")
def start(
    project: Annotated[
        str,
        typer.Option("--project", "-p", help="Project slug."),
    ],
    title: Annotated[
        str,
        typer.Option("--title", "-t", help="Human-readable title for the run."),
    ],
    cases: Annotated[
        str | None,
        typer.Option(
            "--cases",
            help=(
                "Comma-separated wombat_ids (TC-001,TC-002) or @file.txt "
                "with one ID per line. Mutually exclusive with --filter-query."
            ),
        ),
    ] = None,
    filter_query: Annotated[
        str | None,
        typer.Option(
            "--filter-query",
            help=(
                "JSON filter dict selecting cases by attribute. "
                "Mutually exclusive with --cases."
            ),
        ),
    ] = None,
    env: Annotated[
        str | None,
        typer.Option("--env", "-e", help="Environment name (looked up by name on the server)."),
    ] = None,
    server: Annotated[
        str,
        typer.Option(
            "--server",
            help="Wombat API base URL.",
            envvar="WOMBAT_API_URL",
        ),
    ] = "",
    token: Annotated[
        str,
        typer.Option(
            "--token",
            help="Bearer token for API authentication.",
            envvar="WOMBAT_API_TOKEN",
        ),
    ] = "",
) -> None:
    """Create a new test run and print its JSON to stdout.

    Exactly one of ``--cases`` or ``--filter-query`` must be supplied.

    ``--cases`` accepts a comma-separated list of wombat_ids:

    \b
        wombat run start --project demo --title "Smoke" --cases TC-001,TC-002

    Or an @file reference where each line holds one ID:

    \b
        wombat run start --project demo --title "Smoke" --cases @cases.txt

    ``--filter-query`` accepts a JSON object that maps to the case_selection
    filter field:

    \b
        wombat run start --project demo --title "Regression" \\
            --filter-query '{"tags": ["regression"]}'
    """
    import httpx

    if not server:
        typer.echo("Error: --server (or WOMBAT_API_URL) is required.", err=True)
        raise typer.Exit(1)
    if not token:
        typer.echo("Error: --token (or WOMBAT_API_TOKEN) is required.", err=True)
        raise typer.Exit(1)
    if not project:
        typer.echo("Error: --project is required.", err=True)
        raise typer.Exit(1)

    # Mutually exclusive selection
    has_cases = cases is not None
    has_filter = filter_query is not None
    if has_cases == has_filter:
        typer.echo("Error: provide exactly one of --cases or --filter-query.", err=True)
        raise typer.Exit(1)

    # Build case_selection payload
    if has_cases:
        case_ids = _resolve_cases(cases)  # type: ignore[arg-type]
        case_selection: dict = {"case_ids": case_ids}
    else:
        try:
            filter_dict = json.loads(filter_query)  # type: ignore[arg-type]
        except json.JSONDecodeError as exc:
            typer.echo(f"Error: --filter-query is not valid JSON — {exc}", err=True)
            raise typer.Exit(1) from None
        case_selection = {"filter": filter_dict}

    base = server.rstrip("/")
    headers = _make_headers(token)

    # Resolve environment name to UUID if provided
    environment_id: str | None = None
    if env:
        try:
            with httpx.Client(timeout=30) as client:
                env_r = client.get(
                    f"{base}/api/projects/{project}/environments",
                    headers=headers,
                )
                env_r.raise_for_status()
        except httpx.HTTPStatusError as exc:
            _http_error(exc)
        except httpx.RequestError as exc:
            _request_error(exc)

        envs = env_r.json().get("data", [])
        matched = next((e for e in envs if e.get("name") == env), None)
        if matched is None:
            typer.echo(
                f"Error: environment '{env}' not found in project '{project}'. "
                "Use `wombat run start` without --env to skip, or create it first.",
                err=True,
            )
            raise typer.Exit(1)
        environment_id = matched["id"]

    payload: dict = {
        "title": title,
        "case_selection": case_selection,
        "source": "manual",
    }
    if environment_id is not None:
        payload["environment_id"] = environment_id

    url = f"{base}/api/projects/{project}/runs"

    try:
        with httpx.Client(timeout=60) as client:
            r = client.post(url, headers=headers, json=payload)
            r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        _http_error(exc)
    except httpx.RequestError as exc:
        _request_error(exc)

    data = r.json().get("data", r.json())
    typer.echo(json.dumps(data, indent=2, default=str))


# ---------------------------------------------------------------------------
# wombat run record
# ---------------------------------------------------------------------------


@app.command("record")
def record(
    project: Annotated[
        str,
        typer.Option("--project", "-p", help="Project slug."),
    ],
    run: Annotated[
        str,
        typer.Option("--run", "-r", help="Run UUID."),
    ],
    case: Annotated[
        str,
        typer.Option("--case", "-c", help="Case wombat_id (e.g. TC-001)."),
    ],
    status: Annotated[
        str,
        typer.Option(
            "--status", "-s",
            help="Result status: p/pass, f/fail, b/blocked, s/skipped.",
        ),
    ],
    note: Annotated[
        str | None,
        typer.Option("--note", help="Free-text note for this result."),
    ] = None,
    failed_at_step: Annotated[
        int | None,
        typer.Option("--failed-at-step", help="Step number where the failure occurred."),
    ] = None,
    bug: Annotated[
        str | None,
        typer.Option("--bug", help="Bug/issue URL to attach to this result."),
    ] = None,
    duration_ms: Annotated[
        int | None,
        typer.Option("--duration-ms", help="Test execution duration in milliseconds."),
    ] = None,
    if_match: Annotated[
        int | None,
        typer.Option("--if-match", help="Expected current revision for optimistic locking."),
    ] = None,
    server: Annotated[
        str,
        typer.Option(
            "--server",
            help="Wombat API base URL.",
            envvar="WOMBAT_API_URL",
        ),
    ] = "",
    token: Annotated[
        str,
        typer.Option(
            "--token",
            help="Bearer token for API authentication.",
            envvar="WOMBAT_API_TOKEN",
        ),
    ] = "",
) -> None:
    """Record a single test result, echoing the server response as JSON.

    Status short flags: ``p`` = pass, ``f`` = fail, ``b`` = blocked, ``s`` = skipped.

    \b
        wombat run record --project demo --run <UUID> --case TC-001 -s p
        wombat run record --project demo --run <UUID> --case TC-002 -s f \\
            --failed-at-step 3 --bug https://jira.example.com/PROJ-42

    The command posts a single-item batch to
    ``POST /api/projects/{project}/runs/{run}/results``.
    """
    import httpx

    if not server:
        typer.echo("Error: --server (or WOMBAT_API_URL) is required.", err=True)
        raise typer.Exit(1)
    if not token:
        typer.echo("Error: --token (or WOMBAT_API_TOKEN) is required.", err=True)
        raise typer.Exit(1)
    if not project:
        typer.echo("Error: --project is required.", err=True)
        raise typer.Exit(1)

    canonical_status = _STATUS_MAP.get(status.lower())
    if canonical_status is None:
        typer.echo(
            f"Error: unknown status '{status}'. Use p/pass, f/fail, b/blocked, s/skipped.",
            err=True,
        )
        raise typer.Exit(1)

    item: dict = {
        "case_id": case,
        "status": canonical_status,
    }
    if note is not None:
        item["notes"] = note
    if failed_at_step is not None:
        item["failed_at_step"] = failed_at_step
    if bug is not None:
        item["bug_links"] = [{"url": bug}]
    if duration_ms is not None:
        item["duration_ms"] = duration_ms
    if if_match is not None:
        item["if_match_revision"] = if_match

    base = server.rstrip("/")
    url = f"{base}/api/projects/{project}/runs/{run}/results"

    try:
        with httpx.Client(timeout=60) as client:
            r = client.post(url, headers=_make_headers(token), json=[item])
            r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        _http_error(exc)
    except httpx.RequestError as exc:
        _request_error(exc)

    response_data = r.json()
    # Batch response: {"results": [{case_id, ok, revision?, error?}]}
    # Surface only the item relevant to the caller.
    results = response_data.get("results", [])
    if results:
        typer.echo(json.dumps(results[0], indent=2, default=str))
    else:
        typer.echo(json.dumps(response_data, indent=2, default=str))


# ---------------------------------------------------------------------------
# wombat run close
# ---------------------------------------------------------------------------


@app.command("close")
def close(
    project: Annotated[
        str,
        typer.Option("--project", "-p", help="Project slug."),
    ],
    run: Annotated[
        str,
        typer.Option("--run", "-r", help="Run UUID."),
    ],
    reason: Annotated[
        str,
        typer.Option(
            "--reason",
            help="Closure reason: 'completed' or 'aborted'.",
        ),
    ] = "completed",
    note: Annotated[
        str | None,
        typer.Option("--note", help="Optional closure note."),
    ] = None,
    server: Annotated[
        str,
        typer.Option(
            "--server",
            help="Wombat API base URL.",
            envvar="WOMBAT_API_URL",
        ),
    ] = "",
    token: Annotated[
        str,
        typer.Option(
            "--token",
            help="Bearer token for API authentication.",
            envvar="WOMBAT_API_TOKEN",
        ),
    ] = "",
) -> None:
    """Close a run and print the closed RunDetail JSON.

    \b
        wombat run close --project demo --run <UUID> --reason completed
        wombat run close --project demo --run <UUID> --reason aborted \\
            --note "Blocked by infrastructure outage"
    """
    import httpx

    if not server:
        typer.echo("Error: --server (or WOMBAT_API_URL) is required.", err=True)
        raise typer.Exit(1)
    if not token:
        typer.echo("Error: --token (or WOMBAT_API_TOKEN) is required.", err=True)
        raise typer.Exit(1)
    if not project:
        typer.echo("Error: --project is required.", err=True)
        raise typer.Exit(1)

    if reason not in ("completed", "aborted"):
        typer.echo("Error: --reason must be 'completed' or 'aborted'.", err=True)
        raise typer.Exit(1)

    payload: dict = {"reason": reason}
    if note is not None:
        payload["note"] = note

    base = server.rstrip("/")
    url = f"{base}/api/projects/{project}/runs/{run}/close"

    try:
        with httpx.Client(timeout=60) as client:
            r = client.post(url, headers=_make_headers(token), json=payload)
            r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        _http_error(exc)
    except httpx.RequestError as exc:
        _request_error(exc)

    data = r.json().get("data", r.json())
    typer.echo(json.dumps(data, indent=2, default=str))
