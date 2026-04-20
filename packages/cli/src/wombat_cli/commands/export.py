"""wombat export — export entities to various formats."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer

from wombat_cli.formatting import err_console, print_error

_FORMATS = ["json", "yaml", "csv", "markdown"]


def export_command(
    entity_ids: Annotated[
        list[str] | None,
        typer.Argument(help="Entity IDs to export. Exports all if omitted."),
    ] = None,
    fmt: Annotated[
        str,
        typer.Option("--format", "-f", help=f"Output format: {', '.join(_FORMATS)}."),
    ] = "json",
    entity_type: Annotated[
        str | None,
        typer.Option("--type", help="Filter by entity type."),
    ] = None,
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Write to file instead of stdout."),
    ] = None,
    directory: Annotated[
        Path,
        typer.Option("--directory", "-d", help="Root directory containing .wombat/."),
    ] = Path("."),
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Alias for --format json."),
    ] = False,
) -> None:
    """Export wombat entities to JSON, YAML, CSV, or Markdown."""
    if json_output:
        fmt = "json"

    if fmt not in _FORMATS:
        err_console.print(f"[red]Error:[/red] Unknown format {fmt!r}. Choose from: {', '.join(_FORMATS)}")
        raise typer.Exit(1)

    from wombat_cli._helpers import wombat_root
    from wombat_cli.formatting import entity_to_dict
    from wombat_core.config.loader import load_config
    from wombat_core.parsing.writer import serialise_entity
    from wombat_core.search.local import search_files

    config = load_config(directory.resolve())
    root = wombat_root(config)

    if root is None:
        print_error("NOT_INIT", "No .wombat/ directory found.", hint="Run `wombat init` first.")
        raise typer.Exit(1)

    search_result = search_files(root, entity_type=entity_type, limit=100_000)
    entities = search_result.entities

    # Filter by explicit IDs if provided
    if entity_ids:
        id_set = set(entity_ids)
        entities = [e for e in entities if e.id in id_set]

    if not entities:
        err_console.print("[dim]No entities to export.[/dim]")
        sys.exit(0)

    content = _render(entities, fmt, entity_to_dict, serialise_entity)

    if output:
        output.write_text(content, encoding="utf-8")
        from wombat_cli.formatting.table_output import console

        console.print(f"[green]Exported {len(entities)} entities[/green] → {output}")
    else:
        print(content)

    sys.exit(0)


def _render(entities, fmt: str, entity_to_dict, serialise_entity) -> str:  # noqa: ANN001
    """Render a list of entities as the requested format string."""
    if fmt == "json":
        import json as _json

        return _json.dumps([entity_to_dict(e) for e in entities], indent=2)

    if fmt == "yaml":
        import yaml

        return yaml.safe_dump(
            [entity_to_dict(e) for e in entities],
            allow_unicode=True,
            default_flow_style=False,
        )

    if fmt == "csv":
        import csv
        import io

        buf = io.StringIO()
        dicts = [entity_to_dict(e) for e in entities]
        if not dicts:
            return ""
        all_keys: list[str] = list({k for d in dicts for k in d if not isinstance(d[k], (list, dict))})
        writer = csv.DictWriter(
            buf,
            fieldnames=all_keys,
            extrasaction="ignore",
        )
        writer.writeheader()
        writer.writerows(dicts)
        return buf.getvalue()

    if fmt == "markdown":
        lines: list[str] = []
        for entity in entities:
            lines.append(serialise_entity(entity))
            lines.append("")
        return "\n".join(lines)

    return ""
