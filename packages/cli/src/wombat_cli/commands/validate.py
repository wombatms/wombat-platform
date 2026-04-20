"""wombat validate — validate entity files against schemas."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer

from wombat_cli.formatting import err_console, print_error, print_issues, print_json


def validate_command(
    paths: Annotated[
        list[Path] | None,
        typer.Argument(
            help="Files or directories to validate. Defaults to entire .wombat/ tree.",
        ),
    ] = None,
    directory: Annotated[
        Path,
        typer.Option("--directory", "-d", help="Root directory containing .wombat/."),
    ] = Path("."),
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Output results as JSON."),
    ] = False,
) -> None:
    """Validate entity files against the Wombat schema."""
    from wombat_cli._helpers import wombat_root
    from wombat_core.config.loader import load_config
    from wombat_core.search.local import search_files
    from wombat_core.validation import validate_corpus

    config = load_config(directory.resolve())
    root = wombat_root(config)

    if root is None and not paths:
        if json_output:
            print_error(
                "NOT_INIT",
                "No .wombat/ directory found.",
                hint="Run `wombat init` first.",
            )
        else:
            err_console.print("[red]Error:[/red] No .wombat/ directory found. Run `wombat init` first.")
        raise typer.Exit(1)

    scan_root = paths[0] if paths else root
    assert scan_root is not None

    search_result = search_files(scan_root, limit=100_000)
    entities = search_result.entities

    if not entities:
        if json_output:
            print_json({"errors": [], "total": 0, "valid": True})
        else:
            from wombat_cli.formatting.table_output import console

            console.print("[dim]No entities found to validate.[/dim]")
        sys.exit(0)

    result = validate_corpus(entities)

    errors_dicts = [
        {
            "code": "SCHEMA_ERROR",
            "field": e.field,
            "message": e.message,
            "entity_id": e.entity_id,
        }
        for e in result.errors
    ]

    if json_output:
        print_json(
            {
                "errors": errors_dicts,
                "total": len(errors_dicts),
                "valid": result.valid,
            }
        )
    else:
        if result.valid:
            from wombat_cli.formatting.table_output import console

            console.print(f"[green]All {len(entities)} entities are valid.[/green]")
        else:
            print_issues(errors_dicts)

    sys.exit(2 if not result.valid else 0)
