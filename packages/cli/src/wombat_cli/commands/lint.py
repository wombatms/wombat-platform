"""wombat lint — run lint rules against entity files."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer

from wombat_cli.formatting import err_console, print_error, print_issues, print_json


def lint_command(
    paths: Annotated[
        list[Path] | None,
        typer.Argument(
            help="Files or directories to lint. Defaults to entire .wombat/ tree.",
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
    """Run lint rules against wombat entity files."""
    from wombat_cli._helpers import wombat_root
    from wombat_core.config.loader import load_config
    from wombat_core.linting import LintEngine
    from wombat_core.search.local import search_files

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
            err_console.print(
                "[red]Error:[/red] No .wombat/ directory found. "
                "Run `wombat init` first."
            )
        raise typer.Exit(1)

    scan_root = paths[0] if paths else root
    assert scan_root is not None

    search_result = search_files(scan_root, limit=100_000)
    entities = search_result.entities

    if not entities:
        if json_output:
            print_json({"issues": [], "total": 0})
        else:
            from wombat_cli.formatting.table_output import console
            console.print("[dim]No entities found to lint.[/dim]")
        sys.exit(0)

    engine = LintEngine(config)
    issues = engine.lint_corpus(entities)

    issues_dicts = [
        {
            "rule": i.rule,
            "severity": i.severity,
            "message": i.message,
            "entity_id": i.entity_id,
            "field": i.field,
        }
        for i in issues
    ]

    if json_output:
        print_json({"issues": issues_dicts, "total": len(issues_dicts)})
    else:
        if not issues_dicts:
            from wombat_cli.formatting.table_output import console
            console.print("[green]No lint issues found.[/green]")
        else:
            print_issues(issues_dicts)

    sys.exit(2 if issues_dicts else 0)
