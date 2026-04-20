"""wombat search — full-text search across entities."""

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


def search_command(
    query: Annotated[
        str,
        typer.Argument(help="Search query string."),
    ],
    directory: Annotated[
        Path,
        typer.Option("--directory", "-d", help="Root directory containing .wombat/."),
    ] = Path("."),
    entity_type: Annotated[
        str | None,
        typer.Option(
            "--type",
            help="Limit to entity type: testcase|story|plan|suite|shared-step.",
        ),
    ] = None,
    limit: Annotated[
        int,
        typer.Option("--limit", help="Maximum results to return."),
    ] = 20,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Output results as JSON."),
    ] = False,
) -> None:
    """Search entities by text query."""
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

    q = query.lower()

    # Collect all entities and do a simple text search across title/body/tags
    all_result = search_files(root, entity_type=entity_type, limit=100_000)

    matched = []
    for entity in all_result.entities:
        if _entity_matches_query(entity, q):
            matched.append(entity)
        if len(matched) >= limit:
            break

    data = [entity_to_dict(e) for e in matched]

    if json_output:
        print_json({"query": query, "results": data, "count": len(data)})
    else:
        if not data:
            err_console.print(f"[dim]No results for query:[/dim] {query!r}")
        else:
            print_entity_list(data)

    sys.exit(0)


def _entity_matches_query(entity: object, q: str) -> bool:
    """Return True if *q* appears in any searchable string field of *entity*."""
    for attr in ("title", "summary", "description", "body", "component", "owner"):
        val = getattr(entity, attr, None)
        if val and q in str(val).lower():
            return True
    tags: list = getattr(entity, "tags", [])
    return bool(any(q in t.lower() for t in tags))
