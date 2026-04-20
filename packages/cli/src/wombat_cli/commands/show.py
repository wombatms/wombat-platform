"""wombat show — display a single entity by ID."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer

from wombat_cli.formatting import (
    entity_to_dict,
    err_console,
    print_entity_detail,
    print_error,
    print_json,
    print_summary,
)


def show_command(
    entity_id: Annotated[
        str,
        typer.Argument(help="Entity ID (e.g. TC-001, SS-LOGIN, PLAN-Q1)."),
    ],
    directory: Annotated[
        Path,
        typer.Option("--directory", "-d", help="Root directory containing .wombat/."),
    ] = Path("."),
    summary: Annotated[
        bool,
        typer.Option("--summary", help="Return compact agent-friendly context bundle."),
    ] = False,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Output result as JSON."),
    ] = False,
) -> None:
    """Show details for a single entity by ID."""
    from wombat_cli._helpers import find_by_id, wombat_root
    from wombat_core.config.loader import load_config

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
            err_console.print("[red]Error:[/red] No .wombat/ directory found. Run `wombat init` first.")
        raise typer.Exit(1)

    entity = find_by_id(root, entity_id)

    if entity is None:
        if json_output:
            print_error(
                "NOT_FOUND",
                f"Entity '{entity_id}' not found.",
                hint="Check the ID and directory.",
            )
        else:
            err_console.print(f"[red]Not found:[/red] {entity_id}")
        raise typer.Exit(3)

    data = entity_to_dict(entity)

    if json_output:
        if summary:
            print_json(_build_summary(data))
        else:
            print_json(data)
    else:
        if summary:
            print_summary(data)
        else:
            print_entity_detail(data)

    sys.exit(0)


def _build_summary(data: dict) -> dict:
    """Build a compact agent-friendly summary dict from entity data."""
    heavy_fields = {"body", "preconditions", "test_data", "steps"}
    result: dict = {k: v for k, v in data.items() if k not in heavy_fields}
    steps = data.get("steps", [])
    if steps:
        result["step_count"] = len(steps)
    return result
