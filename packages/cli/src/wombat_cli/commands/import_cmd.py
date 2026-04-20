"""wombat import — import XLSX/CSV test data into the local test repo."""

from __future__ import annotations

# Implemented in Task 22; stub only at Task 19 time.
# The full implementation lives below and is activated once wombat_core.importing
# is available (Task 21).
from pathlib import Path
from typing import Annotated

import typer


def import_command(
    file: Annotated[
        Path,
        typer.Argument(help="XLSX or CSV file to import."),
    ],
    profile: Annotated[
        str,
        typer.Option(
            "--profile",
            help="Import mapping profile name or path (e.g. 'azure_devops').",
        ),
    ] = "azure_devops",
    mapping: Annotated[
        Path | None,
        typer.Option("--mapping", help="Path to a custom YAML mapping file."),
    ] = None,
    output: Annotated[
        Path,
        typer.Option("--output", "-o", help="Directory to write Markdown files into."),
    ] = Path("testcases"),
    preview: Annotated[
        bool,
        typer.Option("--preview", help="Show summary without writing files."),
    ] = False,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Show what would be written without writing."),
    ] = False,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Output results as JSON."),
    ] = False,
    server: Annotated[
        str | None,
        typer.Option(
            "--server",
            help="Wombat API base URL. If given, upload to server instead.",
            envvar="WOMBAT_API_URL",
        ),
    ] = None,
    token: Annotated[
        str | None,
        typer.Option(
            "--token",
            help="Bearer token for API authentication.",
            envvar="WOMBAT_API_TOKEN",
        ),
    ] = None,
    project: Annotated[
        str,
        typer.Option("--project", "-p", help="Project slug (required for server mode)."),
    ] = "",
) -> None:
    """Import test cases from an XLSX or CSV file.

    **Local mode** (no ``--server``):
      1. Parse the file using ``wombat_core.importing``.
      2. Apply the selected mapping profile.
      3. If ``--preview``: print a summary of parsed entities and exit.
      4. If ``--dry-run``: print what Markdown files would be written and exit.
      5. Otherwise, write Markdown files into ``--output``.

    **API mode** (``--server`` given):
      Upload the file to ``POST /api/projects/{slug}/imports/upload`` and
      print the server-side import summary.
    """
    from wombat_core.importing import ImportResult, parse_file

    if server:
        _api_import(
            server=server,
            project_slug=project,
            token=token or "",
            file=file,
            profile_name=profile,
            dry_run=dry_run,
        )
        return

    # Local mode
    result: ImportResult = parse_file(file, profile_name=profile, mapping_file=mapping)

    if preview or dry_run:
        _print_preview(result, dry_run=dry_run, json_output=json_output)
        return

    # Write Markdown files
    _write_entities(result, output_dir=output, json_output=json_output)


def _print_preview(result, *, dry_run: bool, json_output: bool) -> None:
    from wombat_cli.formatting import print_json

    mode = "dry-run" if dry_run else "preview"
    if json_output:
        print_json(
            {
                "mode": mode,
                "parsed": len(result.entities),
                "skipped": len(result.skipped),
                "errors": [e for e in result.errors],
                "entities": [e.model_dump(mode="json") for e in result.entities],
            }
        )
    else:
        typer.echo(f"[{mode}] Parsed {len(result.entities)} entity/entities.")
        if result.skipped:
            typer.echo(f"  Skipped {len(result.skipped)} row(s).")
        if result.errors:
            typer.echo(f"  Errors ({len(result.errors)}):")
            for err in result.errors:
                typer.echo(f"    row {err.get('row', '?')}: {err.get('message', err)}")


def _write_entities(result, *, output_dir: Path, json_output: bool) -> None:
    from wombat_cli.formatting import print_json
    from wombat_core.parsing.writer import write_entity

    output_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    for entity in result.entities:
        dest = output_dir / f"{entity.id}.md"
        write_entity(entity, dest)
        written += 1

    if json_output:
        print_json(
            {
                "written": written,
                "skipped": len(result.skipped),
                "errors": result.errors,
            }
        )
    else:
        typer.echo(f"Wrote {written} file(s) to {output_dir}.")
        if result.errors:
            typer.echo(f"  {len(result.errors)} row(s) had errors and were skipped.")


def _api_import(
    server: str,
    project_slug: str,
    token: str,
    file: Path,
    profile_name: str,
    dry_run: bool,
) -> None:
    if not project_slug:
        typer.echo("Error: --project is required in API mode.", err=True)
        raise typer.Exit(1)

    import httpx

    base = server.rstrip("/")
    endpoint = "preview" if dry_run else "execute"
    url = f"{base}/api/projects/{project_slug}/imports/{endpoint}"
    typer.echo(f"Uploading {file.name} to {url} …")

    try:
        with httpx.Client(timeout=300) as client:
            with open(file, "rb") as fh:
                r = client.post(
                    url,
                    headers={"Authorization": f"Bearer {token}"},
                    files={"file": (file.name, fh)},
                    data={"profile": profile_name},
                )
            r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        typer.echo(f"Error: HTTP {exc.response.status_code} — {exc.response.text}", err=True)
        raise typer.Exit(1) from None
    except httpx.RequestError as exc:
        typer.echo(f"Error: request failed — {exc}", err=True)
        raise typer.Exit(1) from None

    data = r.json()
    typer.echo(
        f"Import {endpoint}: "
        f"parsed={data.get('parsed', '?')}  "
        f"skipped={data.get('skipped', '?')}  "
        f"errors={data.get('errors', '?')}"
    )
