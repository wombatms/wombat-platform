"""Rich-based table and tree formatting for human-readable CLI output."""

from __future__ import annotations

from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.tree import Tree

console = Console()
err_console = Console(stderr=True)


# ---------------------------------------------------------------------------
# Generic table helpers
# ---------------------------------------------------------------------------


def make_table(*columns: str, title: str | None = None) -> Table:
    """Create a Rich table with the given column headers."""
    table = Table(title=title, show_header=True, header_style="bold cyan")
    for col in columns:
        table.add_column(col)
    return table


def print_table(table: Table) -> None:
    console.print(table)


# ---------------------------------------------------------------------------
# Entity list table
# ---------------------------------------------------------------------------

_PRIORITY_STYLE = {
    "critical": "bold red",
    "high": "red",
    "medium": "yellow",
    "low": "dim",
}

_STATUS_STYLE = {
    "active": "green",
    "draft": "dim",
    "deprecated": "yellow",
    "archived": "dim red",
}


def print_entity_list(
    entities: list[dict[str, Any]],
    *,
    brief: bool = False,
    ids_only: bool = False,
) -> None:
    """Print a list of entities as a Rich table."""
    if not entities:
        err_console.print("[dim]No results.[/dim]")
        return

    if ids_only:
        for e in entities:
            print(e.get("id", ""))
        return

    if brief:
        table = make_table("ID", "Title", "Status", "Owner")
        for e in entities:
            table.add_row(
                e.get("id", ""),
                e.get("title", ""),
                _styled_status(e.get("status", "")),
                e.get("owner", ""),
            )
    else:
        table = make_table("ID", "Title", "Component", "Priority", "Status", "Owner", "Tags")
        for e in entities:
            tags = ", ".join(e.get("tags", []))
            table.add_row(
                e.get("id", ""),
                e.get("title", ""),
                e.get("component", ""),
                _styled_priority(e.get("priority", "")),
                _styled_status(e.get("status", "")),
                e.get("owner", ""),
                tags,
            )

    print_table(table)


def _styled_priority(value: str) -> Text:
    style = _PRIORITY_STYLE.get(value, "")
    return Text(value, style=style)


def _styled_status(value: str) -> Text:
    style = _STATUS_STYLE.get(value, "")
    return Text(value, style=style)


# ---------------------------------------------------------------------------
# Entity detail view
# ---------------------------------------------------------------------------


def print_entity_detail(entity: dict[str, Any]) -> None:
    """Print a detailed view of a single entity using Rich panels and trees."""
    entity_id = entity.get("id", "?")
    title = entity.get("title", "")
    panel_title = f"[bold]{entity_id}[/bold] — {title}"

    lines: list[str] = []

    def _row(label: str, value: Any) -> None:
        if value is not None and value != "" and value != [] and value != {}:
            lines.append(f"[dim]{label}:[/dim] {value}")

    _row("Status", entity.get("status"))
    _row("Priority", entity.get("priority"))
    _row("Type", entity.get("type"))
    _row("Component", entity.get("component"))
    _row("Owner", entity.get("owner"))
    _row("Version", entity.get("version"))
    _row("Tags", ", ".join(entity.get("tags", [])) or None)
    _row("Requirements", ", ".join(entity.get("requirements", [])) or None)

    if entity.get("summary"):
        lines.append(f"\n[dim]Summary:[/dim] {entity['summary']}")

    if entity.get("steps"):
        lines.append("\n[bold]Steps:[/bold]")
        for step in entity["steps"]:
            n = step.get("number", "?")
            action = step.get("action", "")
            expected = step.get("expected", "")
            lines.append(f"  [cyan]{n}.[/cyan] {action}")
            lines.append(f"     [dim]Expected:[/dim] {expected}")

    automation = entity.get("automation", {})
    if automation:
        lines.append(f"\n[dim]Automation:[/dim] {automation.get('status', '')}")

    review = entity.get("review", {})
    if review:
        lines.append(f"[dim]Review:[/dim] {review.get('state', '')}")

    body = entity.get("body")
    if body:
        lines.append(f"\n[dim]Body:[/dim]\n{body}")

    console.print(Panel("\n".join(lines), title=panel_title, border_style="blue"))


def print_summary(entity: dict[str, Any]) -> None:
    """Print a compact agent-friendly summary of an entity."""
    summary_fields = {
        k: v
        for k, v in entity.items()
        if v is not None
        and v != ""
        and v != []
        and v != {}
        and k not in ("body", "steps", "preconditions", "test_data")
    }
    # Add step count if steps present
    steps = entity.get("steps", [])
    if steps:
        summary_fields["step_count"] = len(steps)
        summary_fields.pop("steps", None)
    console.print(summary_fields)


# ---------------------------------------------------------------------------
# Lint / validation issue table
# ---------------------------------------------------------------------------


def print_issues(
    issues: list[dict[str, Any]],
    *,
    source: str | None = None,
) -> None:
    """Print lint or validation issues as a table."""
    if not issues:
        console.print("[green]No issues found.[/green]")
        return

    title = f"Issues in {source}" if source else "Issues"
    table = make_table("Severity", "Rule / Code", "Field", "Message", title=title)
    for issue in issues:
        severity = issue.get("severity", issue.get("level", "error"))
        rule = issue.get("rule", issue.get("code", ""))
        field = issue.get("field", "")
        message = issue.get("message", "")
        style = "red" if severity in ("error", "critical") else "yellow"
        table.add_row(
            Text(severity, style=style),
            rule,
            field or "",
            message,
        )
    print_table(table)


# ---------------------------------------------------------------------------
# Diff output
# ---------------------------------------------------------------------------


def print_diff(
    old: dict[str, Any],
    new: dict[str, Any],
    *,
    entity_id: str | None = None,
) -> None:
    """Print a side-by-side diff of two entity dicts."""
    import difflib
    import json as _json

    old_str = _json.dumps(old, indent=2)
    new_str = _json.dumps(new, indent=2)
    diff_lines = list(
        difflib.unified_diff(
            old_str.splitlines(keepends=True),
            new_str.splitlines(keepends=True),
            fromfile=f"{entity_id or 'old'} (before)",
            tofile=f"{entity_id or 'new'} (after)",
        )
    )
    if not diff_lines:
        console.print("[dim]No differences.[/dim]")
        return
    for line in diff_lines:
        if line.startswith("+"):
            console.print(Text(line.rstrip(), style="green"), end="\n")
        elif line.startswith("-"):
            console.print(Text(line.rstrip(), style="red"), end="\n")
        elif line.startswith("@@"):
            console.print(Text(line.rstrip(), style="cyan"), end="\n")
        else:
            console.print(line.rstrip())


# ---------------------------------------------------------------------------
# Config display
# ---------------------------------------------------------------------------


def print_config(config_dict: dict[str, Any]) -> None:
    """Print config as a Rich tree."""
    tree = Tree("[bold]wombat config[/bold]")
    _add_dict_to_tree(tree, config_dict)
    console.print(tree)


def _add_dict_to_tree(node: Tree, data: Any, key: str | None = None) -> None:
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, (dict, list)):
                branch = node.add(f"[cyan]{k}[/cyan]")
                _add_dict_to_tree(branch, v, k)
            else:
                node.add(f"[cyan]{k}:[/cyan] {v}")
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                branch = node.add("[dim]- (object)[/dim]")
                _add_dict_to_tree(branch, item)
            else:
                node.add(f"[dim]-[/dim] {item}")
