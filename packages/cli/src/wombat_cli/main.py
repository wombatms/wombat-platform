"""Wombat CLI entry point — `wombat` command."""

from __future__ import annotations

import typer

from wombat_cli.commands import (
    config_command,
    create_command,
    diff_command,
    export_command,
    import_command,
    init_command,
    lint_command,
    list_command,
    rag_app,
    run_app,
    search_command,
    show_command,
    sync_command,
    update_command,
    validate_command,
)

app = typer.Typer(
    name="wombat",
    help="Agent-friendly test case management platform.",
    no_args_is_help=True,
    add_completion=True,
)

# ---------------------------------------------------------------------------
# Project setup
# ---------------------------------------------------------------------------

app.command("init", help="Initialise a .wombat/ project in the current directory.")(init_command)

# ---------------------------------------------------------------------------
# Read commands
# ---------------------------------------------------------------------------

app.command("show", help="Show details for a single entity by ID.")(show_command)
app.command("list", help="List entities with optional filters and pagination.")(list_command)
app.command("search", help="Full-text search across all entities.")(search_command)

# ---------------------------------------------------------------------------
# Quality commands
# ---------------------------------------------------------------------------

app.command("lint", help="Run lint rules against entity files.")(lint_command)
app.command("validate", help="Validate entity files against the Wombat schema.")(validate_command)

# ---------------------------------------------------------------------------
# Write commands
# ---------------------------------------------------------------------------

app.command("create", help="Create a new entity.")(create_command)
app.command("update", help="Update fields on an existing entity.")(update_command)
app.command("diff", help="Show differences between entity versions.")(diff_command)

# ---------------------------------------------------------------------------
# Utility commands
# ---------------------------------------------------------------------------

app.command("export", help="Export entities to JSON, YAML, CSV, or Markdown.")(export_command)
app.command("config", help="Read or write .wombat/config.yaml settings.")(config_command)

# ---------------------------------------------------------------------------
# Server-integration commands (SP2)
# ---------------------------------------------------------------------------

app.command("sync", help="Sync Git-canonical content into the Wombat DB and RAG index.")(sync_command)
app.command("import", help="Import test cases from XLSX or CSV file.")(import_command)
app.add_typer(rag_app, name="rag")
app.add_typer(run_app, name="run")


if __name__ == "__main__":
    app()
