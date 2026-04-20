"""wombat update — apply field patches to an existing entity."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer

from wombat_cli.formatting import err_console, print_error, print_json


def update_command(
    entity_id: Annotated[
        str,
        typer.Argument(help="Entity ID to update."),
    ],
    set_fields: Annotated[
        list[str] | None,
        typer.Option(
            "--set",
            help="Set a field: --set key=value (repeatable).",
        ),
    ] = None,
    change_reason: Annotated[
        str | None,
        typer.Option("--reason", help="Reason for the change (stored in change_reason)."),
    ] = None,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Show the patched entity without writing to disk."),
    ] = False,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Output result as JSON."),
    ] = False,
    directory: Annotated[
        Path,
        typer.Option("--directory", "-d", help="Root directory containing .wombat/."),
    ] = Path("."),
) -> None:
    """Update fields on an existing entity. Version is auto-incremented on write."""
    from wombat_cli._helpers import find_by_id, find_file_for_id, wombat_root
    from wombat_cli.formatting import entity_to_dict
    from wombat_core.config.loader import load_config
    from wombat_core.parsing.writer import serialise_entity, write_entity

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

    entity = find_by_id(root, entity_id)
    if entity is None:
        if json_output:
            print_error("NOT_FOUND", f"Entity '{entity_id}' not found.")
        else:
            err_console.print(f"[red]Not found:[/red] {entity_id}")
        raise typer.Exit(3)

    # Parse --set key=value pairs
    patches: dict[str, object] = {}
    for field_expr in set_fields or []:
        if "=" not in field_expr:
            msg = f"Invalid --set expression: {field_expr!r} (expected key=value)"
            if json_output:
                print_error("INVALID_ARG", msg, field="--set")
            else:
                err_console.print(f"[red]Error:[/red] {msg}")
            raise typer.Exit(1)
        key, _, value = field_expr.partition("=")
        patches[key.strip()] = _coerce(value.strip())

    if change_reason:
        patches["change_reason"] = change_reason

    # Apply patches via model_copy
    current_data = entity.model_dump()
    current_data.update(patches)
    # Auto-increment version
    current_data["version"] = int(current_data.get("version", 1)) + 1

    updated = type(entity)(**current_data)
    new_version: int = updated.version  # type: ignore[attr-defined]

    content = serialise_entity(updated)

    if dry_run:
        if json_output:
            print_json({
                "entity": entity_to_dict(updated),
                "version": new_version,
                "dry_run": True,
            })
        else:
            from wombat_cli.formatting.table_output import console
            console.print("[dim](dry-run — not written)[/dim]")
            console.print(content)
        sys.exit(0)

    file_path = find_file_for_id(root, entity_id)
    if file_path is None:
        if json_output:
            print_error("NOT_FOUND", f"File for '{entity_id}' not found.")
        else:
            err_console.print(f"[red]File not found for:[/red] {entity_id}")
        raise typer.Exit(3)

    write_entity(updated, file_path)

    if json_output:
        print_json({
            "entity": entity_to_dict(updated),
            "path": str(file_path),
            "version": new_version,
            "written": True,
        })
    else:
        from wombat_cli.formatting.table_output import console
        console.print(
            f"[green]Updated[/green] [bold]{entity_id}[/bold] "
            f"→ version {new_version} ({file_path})"
        )

    sys.exit(0)


def _coerce(value: str) -> object:
    """Attempt type coercion: bool → int → float → str."""
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    if value.isdigit():
        return int(value)
    try:
        return float(value)
    except ValueError:
        return value
