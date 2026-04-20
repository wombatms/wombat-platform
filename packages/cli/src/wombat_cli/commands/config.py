"""wombat config — inspect and modify the .wombat/config.yaml."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Annotated

import typer

from wombat_cli.formatting import err_console, print_config, print_error, print_json


def config_command(
    key: Annotated[
        str | None,
        typer.Argument(help="Dot-separated config key to read (e.g. project.name)."),
    ] = None,
    set_value: Annotated[
        str | None,
        typer.Option("--set", help="Set a config value: --set project.name=MyProject"),
    ] = None,
    directory: Annotated[
        Path,
        typer.Option("--directory", "-d", help="Root directory to locate .wombat/."),
    ] = Path("."),
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Output result as JSON."),
    ] = False,
) -> None:
    """Read or write .wombat/config.yaml settings."""
    from wombat_core.config.loader import load_config

    config = load_config(directory.resolve())

    if config.config_path is None:
        if json_output:
            print_error(
                "NOT_INIT",
                "No .wombat/config.yaml found.",
                hint="Run `wombat init` first.",
            )
        else:
            err_console.print("[red]Error:[/red] No .wombat/config.yaml found. Run `wombat init` first.")
        raise typer.Exit(1)

    # Handle --set key=value
    if set_value:
        if "=" not in set_value:
            msg = f"Invalid --set expression: {set_value!r} (expected key=value)"
            if json_output:
                print_error("INVALID_ARG", msg, field="--set")
            else:
                err_console.print(f"[red]Error:[/red] {msg}")
            raise typer.Exit(1)
        set_key, _, val = set_value.partition("=")
        _write_config_value(config.config_path, set_key.strip(), val.strip())
        if json_output:
            print_json({"set": set_key.strip(), "value": val.strip()})
        else:
            from wombat_cli.formatting.table_output import console

            console.print(f"[green]Set[/green] {set_key.strip()} = {val.strip()}")
        sys.exit(0)

    # Build config dict for display
    config_dict = _config_to_dict(config)

    if key:
        value = _get_nested(config_dict, key)
        if value is None:
            if json_output:
                print_error("NOT_FOUND", f"Config key '{key}' not found.")
            else:
                err_console.print(f"[red]Not found:[/red] config key '{key}'")
            raise typer.Exit(3)
        if json_output:
            print_json({key: value})
        else:
            from wombat_cli.formatting.table_output import console

            console.print(f"{key} = {value}")
    else:
        if json_output:
            print_json(config_dict)
        else:
            print_config(config_dict)

    sys.exit(0)


def _config_to_dict(config) -> dict:
    """Convert WombatConfig to a plain dict."""
    return {
        "project": {
            "id": config.project.id,
            "name": config.project.name,
            "org": config.project.org,
            "default_owner": config.project.default_owner,
        },
        "taxonomy": {
            "components": config.taxonomy.components,
            "environments": config.taxonomy.environments,
        },
        "lint": {
            "rules": config.lint.rules,
        },
        "templates": {
            "directory": config.templates.directory,
        },
        "id": {
            "auto_sequence": config.id.auto_sequence,
        },
        "config_path": str(config.config_path) if config.config_path else None,
    }


def _get_nested(data: dict, key: str):
    """Get a value from a nested dict using dot notation."""
    parts = key.split(".")
    current = data
    for part in parts:
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def _write_config_value(config_path: Path, key: str, value: str) -> None:
    """Write a single key=value into config.yaml using ruamel.yaml or yaml."""
    try:
        import ruamel.yaml as _ry

        ryaml = _ry.YAML()
        ryaml.preserve_quotes = True
        with open(config_path) as f:
            data = ryaml.load(f)
        _set_nested(data, key.split("."), value)
        with open(config_path, "w") as f:
            ryaml.dump(data, f)
    except ImportError:
        import yaml

        with open(config_path) as f:
            data = yaml.safe_load(f) or {}
        _set_nested(data, key.split("."), value)
        with open(config_path, "w") as f:
            yaml.safe_dump(data, f, default_flow_style=False, allow_unicode=True)


def _set_nested(data: dict, keys: list[str], value: str) -> None:
    """Set a value in a nested dict by key path."""
    for k in keys[:-1]:
        data = data.setdefault(k, {})
    # Attempt type coercion: bool, int, else string
    final_key = keys[-1]
    if value.lower() in ("true", "false"):
        data[final_key] = value.lower() == "true"
    elif value.isdigit():
        data[final_key] = int(value)
    else:
        data[final_key] = value
