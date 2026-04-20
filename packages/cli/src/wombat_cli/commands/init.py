"""wombat init — scaffold .wombat/ project structure."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer

from wombat_cli.formatting import err_console, print_error

# Subdirectories created inside the wombat directory
_SUBDIRS = ["testcases", "shared-steps", "plans", "stories", "suites"]

_DEFAULT_CONFIG = """\
project:
  id: "{project_id}"
  name: "{project_name}"
  org: ""
  default_owner: ""

taxonomy:
  components: []
  environments: []

lint:
  rules: {{}}

templates:
  directory: "templates/"

id:
  auto_sequence: false
"""


def init_command(
    directory: Annotated[
        Path,
        typer.Argument(
            help="Directory to initialise. Defaults to current directory.",
            show_default=False,
        ),
    ] = Path("."),
    project_id: Annotated[
        str,
        typer.Option("--id", help="Project ID slug."),
    ] = "",
    project_name: Annotated[
        str,
        typer.Option("--name", help="Human-readable project name."),
    ] = "",
    force: Annotated[
        bool,
        typer.Option("--force", help="Overwrite existing config.yaml."),
    ] = False,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Output result as JSON."),
    ] = False,
) -> None:
    """Initialise a .wombat/ directory structure in the given directory."""
    root = directory.resolve()

    if not root.exists():
        if json_output:
            print_error("NOT_FOUND", f"Directory does not exist: {root}")
        else:
            err_console.print(f"[red]Error:[/red] Directory does not exist: {root}")
        raise typer.Exit(1)

    wombat_dir = root / ".wombat"
    config_file = wombat_dir / "config.yaml"

    if config_file.exists() and not force:
        if json_output:
            print_error(
                "ALREADY_INIT",
                f"{config_file} already exists.",
                hint="Use --force to overwrite.",
            )
        else:
            err_console.print(
                f"[yellow]Already initialised:[/yellow] {config_file} exists. "
                "Use --force to overwrite."
            )
        raise typer.Exit(1)

    created: list[str] = []

    # Create .wombat/ and subdirectories
    wombat_dir.mkdir(parents=True, exist_ok=True)
    for subdir in _SUBDIRS:
        (wombat_dir / subdir).mkdir(exist_ok=True)
        created.append(str(wombat_dir / subdir))

    # Write config.yaml
    pid = project_id or root.name.lower().replace(" ", "-")
    pname = project_name or root.name
    config_content = _DEFAULT_CONFIG.format(project_id=pid, project_name=pname)
    config_file.write_text(config_content)
    created.append(str(config_file))

    if json_output:
        import json as _json

        print(_json.dumps({"created": created, "wombat_dir": str(wombat_dir)}, indent=2))
    else:
        from rich.console import Console

        con = Console()
        con.print(f"[green]Initialised wombat project at[/green] [bold]{wombat_dir}[/bold]")
        for path in created:
            con.print(f"  [dim]created[/dim] {path}")

    sys.exit(0)
