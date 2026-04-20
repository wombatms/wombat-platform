"""wombat create — create a new entity from a template or with defaults."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer

from wombat_cli.formatting import err_console, print_error, print_json


def create_command(
    entity_type: Annotated[
        str,
        typer.Argument(help="Entity type: testcase, story, plan, suite, shared-step."),
    ],
    entity_id: Annotated[
        str | None,
        typer.Option(
            "--id",
            help=("Explicit entity ID. Auto-sequenced if omitted and id.auto_sequence=true."),
        ),
    ] = None,
    title: Annotated[
        str | None,
        typer.Option("--title", "-t", help="Entity title."),
    ] = None,
    from_template: Annotated[
        Path | None,
        typer.Option("--from-template", help="Path to a template file to base the new entity on."),
    ] = None,
    output: Annotated[
        Path | None,
        typer.Option(
            "--output",
            "-o",
            help="Write entity to this file. Defaults to .wombat/<type>/<id>.<ext>.",
        ),
    ] = None,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Print the entity without writing to disk."),
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
    """Create a new Wombat entity."""
    from wombat_cli._helpers import entity_subdir, next_sequence_id, wombat_root
    from wombat_core.config.loader import load_config
    from wombat_core.parsing.frontmatter import parse_markdown_file
    from wombat_core.parsing.writer import serialise_entity, write_entity
    from wombat_core.parsing.yaml_parser import parse_yaml_file

    config = load_config(directory.resolve())
    root = wombat_root(config)

    if root is None and not dry_run:
        if json_output:
            print_error(
                "NOT_INIT",
                "No .wombat/ directory found.",
                hint="Run `wombat init` first.",
            )
        else:
            err_console.print("[red]Error:[/red] No .wombat/ directory found. Run `wombat init` first.")
        raise typer.Exit(1)

    # Resolve ID
    if entity_id is None:
        if config.id.auto_sequence and root is not None:
            entity_id = next_sequence_id(root, entity_type)
        else:
            if json_output:
                print_error(
                    "MISSING_ID",
                    "No --id provided and id.auto_sequence is not enabled.",
                    hint="Pass --id or set id.auto_sequence: true in config.",
                )
            else:
                err_console.print(
                    "[red]Error:[/red] No --id provided. Pass --id or enable id.auto_sequence in .wombat/config.yaml."
                )
            raise typer.Exit(1)

    # Build initial data from template or defaults
    entity_data: dict = {}
    if from_template is not None:
        suffix = from_template.suffix.lower()
        result = parse_markdown_file(from_template) if suffix == ".md" else parse_yaml_file(from_template)
        if not result.ok or result.entity is None:
            if json_output:
                print_error(
                    "TEMPLATE_ERROR",
                    f"Failed to parse template: {result.error}",
                )
            else:
                err_console.print(f"[red]Template error:[/red] {result.error}")
            raise typer.Exit(1)
        entity_data = result.entity.model_dump()

    # Override with provided values
    entity_data["id"] = entity_id
    if title:
        entity_data["title"] = title
    if "title" not in entity_data or not entity_data["title"]:
        entity_data["title"] = entity_id
    entity_data["version"] = 1

    # Instantiate entity model
    entity = _build_entity(entity_type, entity_data)
    if entity is None:
        if json_output:
            print_error("UNKNOWN_TYPE", f"Unknown entity type: {entity_type!r}")
        else:
            err_console.print(f"[red]Error:[/red] Unknown entity type: {entity_type!r}")
        raise typer.Exit(1)

    content = serialise_entity(entity)

    if dry_run:
        if json_output:
            from wombat_cli.formatting import entity_to_dict

            print_json({"entity": entity_to_dict(entity), "dry_run": True})
        else:
            from wombat_cli.formatting.table_output import console

            console.print("[dim](dry-run — not written)[/dim]")
            console.print(content)
        sys.exit(0)

    # Determine output path
    if output is None and root is not None:
        ext = ".yaml" if entity_type.lower() in ("plan", "suite") else ".md"
        subdir = entity_subdir(root, entity_type)
        output = subdir / f"{entity_id}{ext}"

    if output is not None:
        write_entity(entity, output)
        if json_output:
            from wombat_cli.formatting import entity_to_dict

            print_json(
                {
                    "entity": entity_to_dict(entity),
                    "path": str(output),
                    "written": True,
                }
            )
        else:
            from wombat_cli.formatting.table_output import console

            console.print(f"[green]Created[/green] [bold]{entity_id}[/bold] → {output}")
    else:
        print(content)

    sys.exit(0)


def _build_entity(entity_type: str, data: dict):  # noqa: ANN201
    """Instantiate the correct model class for *entity_type*."""
    from wombat_core.models import Plan, SharedStep, Story, Suite, TestCase

    type_map = {
        "testcase": TestCase,
        "test_case": TestCase,
        "shared_step": SharedStep,
        "sharedstep": SharedStep,
        "shared-step": SharedStep,
        "plan": Plan,
        "story": Story,
        "suite": Suite,
    }
    cls = type_map.get(entity_type.lower())
    if cls is None:
        return None
    # Provide minimal required fields if missing
    if issubclass(cls, (TestCase, SharedStep, Story, Suite)) and "owner" not in data:
        data.setdefault("owner", "")
    if issubclass(cls, TestCase) and "component" not in data:
        data.setdefault("component", "")
    try:
        return cls(**data)
    except Exception:  # noqa: BLE001
        return cls.model_construct(**data)
