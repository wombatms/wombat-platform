"""wombat diff — compare two versions of an entity."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer

from wombat_cli.formatting import err_console, print_diff, print_error, print_json


def diff_command(
    entity_id: Annotated[
        str,
        typer.Argument(help="Entity ID to diff."),
    ],
    file_a: Annotated[
        Path | None,
        typer.Option(
            "--file-a",
            help="Compare against a specific file instead of the live version.",
        ),
    ] = None,
    file_b: Annotated[
        Path | None,
        typer.Option("--file-b", help="Second file for comparison."),
    ] = None,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Show diff without applying any changes."),
    ] = False,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Output result as JSON diff."),
    ] = False,
    directory: Annotated[
        Path,
        typer.Option("--directory", "-d", help="Root directory containing .wombat/."),
    ] = Path("."),
) -> None:
    """Show differences between two versions of an entity.

    With no file arguments, shows changes between the live entity and stdin
    or highlights changed fields when used with --set (pipe from update --dry-run).
    """
    from wombat_cli._helpers import find_by_id, wombat_root
    from wombat_cli.formatting import entity_to_dict
    from wombat_core.config.loader import load_config
    from wombat_core.parsing.frontmatter import parse_markdown_file
    from wombat_core.parsing.yaml_parser import parse_yaml_file

    config = load_config(directory.resolve())
    root = wombat_root(config)

    old_data: dict
    new_data: dict

    if file_a is not None and file_b is not None:
        # Compare two arbitrary files
        old_result = _parse_file(file_a, parse_markdown_file, parse_yaml_file)
        new_result = _parse_file(file_b, parse_markdown_file, parse_yaml_file)
        if old_result is None:
            if json_output:
                print_error("PARSE_ERROR", f"Could not parse: {file_a}")
            else:
                err_console.print(f"[red]Error:[/red] Could not parse: {file_a}")
            raise typer.Exit(1)
        if new_result is None:
            if json_output:
                print_error("PARSE_ERROR", f"Could not parse: {file_b}")
            else:
                err_console.print(f"[red]Error:[/red] Could not parse: {file_b}")
            raise typer.Exit(1)
        old_data = entity_to_dict(old_result)
        new_data = entity_to_dict(new_result)

    elif file_a is not None:
        # Compare file_a against live entity
        if root is None:
            if json_output:
                print_error("NOT_INIT", "No .wombat/ directory found.")
            else:
                err_console.print("[red]Error:[/red] No .wombat/ directory found.")
            raise typer.Exit(1)
        file_entity = _parse_file(file_a, parse_markdown_file, parse_yaml_file)
        live_entity = find_by_id(root, entity_id)
        if file_entity is None:
            if json_output:
                print_error("PARSE_ERROR", f"Could not parse: {file_a}")
            else:
                err_console.print(f"[red]Error:[/red] Could not parse: {file_a}")
            raise typer.Exit(1)
        if live_entity is None:
            if json_output:
                print_error("NOT_FOUND", f"Entity '{entity_id}' not found.")
            else:
                err_console.print(f"[red]Not found:[/red] {entity_id}")
            raise typer.Exit(3)
        old_data = entity_to_dict(live_entity)
        new_data = entity_to_dict(file_entity)

    else:
        # No files provided — just show the current entity (useful for inspection)
        if root is None:
            if json_output:
                print_error("NOT_INIT", "No .wombat/ directory found.")
            else:
                err_console.print("[red]Error:[/red] No .wombat/ directory found.")
            raise typer.Exit(1)
        entity = find_by_id(root, entity_id)
        if entity is None:
            if json_output:
                print_error("NOT_FOUND", f"Entity '{entity_id}' not found.")
            else:
                err_console.print(f"[red]Not found:[/red] {entity_id}")
            raise typer.Exit(3)
        data = entity_to_dict(entity)
        if json_output:
            print_json({"entity_id": entity_id, "entity": data})
        else:
            from wombat_cli.formatting import print_entity_detail
            print_entity_detail(data)
        sys.exit(0)

    changed_fields = [
        k for k in set(old_data) | set(new_data)
        if old_data.get(k) != new_data.get(k)
    ]

    if json_output:
        print_json({
            "entity_id": entity_id,
            "old": old_data,
            "new": new_data,
            "changed_fields": changed_fields,
        })
    else:
        if not changed_fields:
            from wombat_cli.formatting.table_output import console
            console.print("[dim]No differences.[/dim]")
        else:
            print_diff(old_data, new_data, entity_id=entity_id)

    sys.exit(0)


def _parse_file(path: Path, parse_md, parse_yaml):  # noqa: ANN001, ANN201
    """Parse a file returning the entity or None on failure."""
    suffix = path.suffix.lower()
    if suffix == ".md":
        result = parse_md(path)
    elif suffix in {".yaml", ".yml"}:
        result = parse_yaml(path)
    else:
        return None
    return result.entity if result.ok else None
