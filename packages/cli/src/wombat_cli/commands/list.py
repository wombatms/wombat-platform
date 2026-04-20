"""wombat list — list entities with filtering and pagination."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer

from wombat_cli.formatting import (
    entity_to_dict,
    err_console,
    print_entity_list,
    print_error,
    print_json,
)


def list_command(
    directory: Annotated[
        Path,
        typer.Option("--directory", "-d", help="Root directory containing .wombat/."),
    ] = Path("."),
    # --- Filter options ---
    component: Annotated[
        str | None,
        typer.Option("--component", help="Filter by component name."),
    ] = None,
    owner: Annotated[
        str | None,
        typer.Option("--owner", help="Filter by owner."),
    ] = None,
    priority: Annotated[
        str | None,
        typer.Option("--priority", help="Filter by priority (critical|high|medium|low)."),
    ] = None,
    status: Annotated[
        str | None,
        typer.Option("--status", help="Filter by status."),
    ] = None,
    tags: Annotated[
        str | None,
        typer.Option("--tags", help="Comma-separated tags to filter by (all must match)."),
    ] = None,
    entity_type: Annotated[
        str | None,
        typer.Option("--type", help="Entity type: testcase|story|plan|suite|shared-step."),
    ] = None,
    automation_status: Annotated[
        str | None,
        typer.Option("--automation-status", help="Filter by automation status."),
    ] = None,
    review_state: Annotated[
        str | None,
        typer.Option("--review-state", help="Filter by review state."),
    ] = None,
    # --- Pagination ---
    limit: Annotated[
        int,
        typer.Option("--limit", help="Maximum results to return."),
    ] = 50,
    offset: Annotated[
        int,
        typer.Option("--offset", help="Number of results to skip."),
    ] = 0,
    # --- Output options ---
    brief: Annotated[
        bool,
        typer.Option("--brief", help="Show fewer columns."),
    ] = False,
    ids_only: Annotated[
        bool,
        typer.Option("--ids-only", help="Output only entity IDs, one per line."),
    ] = False,
    count: Annotated[
        bool,
        typer.Option("--count", help="Output only the total count."),
    ] = False,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Output result as JSON."),
    ] = False,
) -> None:
    """List entities with optional filters and pagination."""
    from wombat_cli._helpers import wombat_root
    from wombat_core.config.loader import load_config
    from wombat_core.search.local import search_files

    config = load_config(directory.resolve())
    root = wombat_root(config)

    if root is None:
        if json_output:
            print_error(
                "NOT_INIT",
                "No .wombat/ directory found.",
                hint="Run `wombat init` first.",
            )
        else:
            err_console.print(
                "[red]Error:[/red] No .wombat/ directory found. "
                "Run `wombat init` first."
            )
        raise typer.Exit(1)

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None

    search_result = search_files(
        root,
        entity_type=entity_type,
        component=component,
        owner=owner,
        priority=priority,
        status=status,
        tags=tag_list,
        limit=limit,
        offset=offset,
    )

    # Apply automation_status / review_state post-filter (not in search_files)
    entities = search_result.entities
    if automation_status:
        entities = [
            e for e in entities
            if getattr(getattr(e, "automation", None), "status", None) == automation_status
        ]
    if review_state:
        entities = [
            e for e in entities
            if getattr(getattr(e, "review", None), "state", None) == review_state
        ]

    data = [entity_to_dict(e) for e in entities]
    total = len(data)

    if count:
        if json_output:
            print_json({"count": total})
        else:
            print(total)
        sys.exit(0)

    if json_output:
        if ids_only:
            print_json([d.get("id") for d in data])
        else:
            print_json({
                "results": data,
                "count": total,
                "limit": limit,
                "offset": offset,
            })
    else:
        print_entity_list(data, brief=brief, ids_only=ids_only)

    sys.exit(0)
